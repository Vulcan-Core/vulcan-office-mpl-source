/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/*
 * This file is part of the Collabora Office project.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * This file incorporates work covered by the following license notice:
 *
 *   Licensed to the Apache Software Foundation (ASF) under one or more
 *   contributor license agreements. See the NOTICE file distributed
 *   with this work for additional information regarding copyright
 *   ownership. The ASF licenses this file to you under the Apache
 *   License, Version 2.0 (the "License"); you may not use this file
 *   except in compliance with the License. You may obtain a copy of
 *   the License at http://www.apache.org/licenses/LICENSE-2.0 .
 */

#include <config_wasm_strip.h>

#include <sal/config.h>
#include <sal/log.hxx>

#include <com/sun/star/beans/XPropertySet.hpp>
#include <com/sun/star/container/XNamed.hpp>
#include <com/sun/star/drawing/XDrawPage.hpp>
#include <com/sun/star/drawing/XDrawPages.hpp>
#include <com/sun/star/drawing/XMasterPagesSupplier.hpp>
#include <com/sun/star/frame/XModel.hpp>
#include <com/sun/star/lang/XMultiServiceFactory.hpp>
#include <com/sun/star/uno/XComponentContext.hpp>
#include <com/sun/star/document/XUndoManager.hpp>
#include <com/sun/star/document/XUndoManagerSupplier.hpp>
#include <comphelper/diagnose_ex.hxx>
#include <comphelper/propertysequence.hxx>
#include <comphelper/propertyvalue.hxx>
#include <comphelper/scopeguard.hxx>
#include <comphelper/sequence.hxx>
#include <comphelper/sequenceashashmap.hxx>
#include <rtl/strbuf.hxx>
#include <vcl/svapp.hxx>
#include <vcl/weld.hxx>
#include <svtools/sfxecode.hxx>
#include <svtools/ehdl.hxx>
#include <tools/urlobj.hxx>
#include <svx/dialmgr.hxx>
#include <svx/strings.hrc>
#include <oox/ppt/pptimport.hxx>
#include <oox/drawingml/chart/chartconverter.hxx>
#include <oox/drawingml/theme.hxx>
#include <oox/dump/pptxdumper.hxx>
#include <drawingml/table/tablestylelistfragmenthandler.hxx>
#include <oox/helper/graphichelper.hxx>
#include <oox/ole/vbaproject.hxx>
#include <oox/ppt/presentationfragmenthandler.hxx>
#include <oox/ppt/presPropsfragmenthandler.hxx>
#include <oox/token/tokens.hxx>

#include <algorithm>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

using namespace ::com::sun::star;
using namespace ::com::sun::star::uno;
using namespace cpo::uno;
using namespace ::com::sun::star::xml::sax;
using namespace oox::core;

using ::com::sun::star::beans::PropertyValue;
using ::com::sun::star::lang::XComponent;

namespace oox::ppt {

#if OSL_DEBUG_LEVEL > 0
XmlFilterBase* PowerPointImport::mpDebugFilterBase = nullptr;
#endif

PowerPointImport::PowerPointImport( const Reference< XComponentContext >& rxContext ) :
    XmlFilterBase( rxContext ),
#if ENABLE_WASM_STRIP_CHART
    // WASM_CHART change
    mxChartConv( )
#else
    mxChartConv( std::make_shared<::oox::drawingml::chart::ChartConverter>() )
#endif
{
#if OSL_DEBUG_LEVEL > 0
    mpDebugFilterBase = this;
#endif
}

PowerPointImport::~PowerPointImport()
{
}

namespace {

// VULCAN: what a deck holds that no part of the document model keeps - each slide
// master's text styles (p:txStyles), ppt/tableStyles.xml and ppt/viewProps.xml - goes into the
// model's grab bag as the file has it, and PowerPointExport writes it back. Without it every save
// of a deck dropped them: PowerPoint then gave titles and bullets its own default sizes and fonts,
// and a table no longer named its style.

bool lcl_isNCNameChar(char c)
{
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_'
           || c == '-' || c == '.';
}

bool lcl_isSpace(char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; }

/// The position of the '>' that closes the tag opening at nTag, past quoted attribute values
size_t lcl_tagEnd(std::string_view aXml, size_t nTag)
{
    char cQuote = 0;
    for (size_t i = nTag + 1; i < aXml.size(); ++i)
    {
        const char c = aXml[i];
        if (cQuote)
        {
            if (c == cQuote)
                cQuote = 0;
        }
        else if (c == '"' || c == '\'')
            cQuote = c;
        else if (c == '>')
            return i;
        else if (c == '<')
            break;
    }
    return std::string_view::npos;
}

struct TagAttribute
{
    std::string_view aName;
    std::string_view aValue;
    std::string_view aText; ///< name="value", as the tag has it
};

/// The attributes of the start tag aTag ('<' to '>'); none for markup this reader does not follow
std::optional<std::vector<TagAttribute>> lcl_tagAttributes(std::string_view aTag)
{
    std::vector<TagAttribute> aAttributes;
    size_t i = 1;
    while (i < aTag.size() && (lcl_isNCNameChar(aTag[i]) || aTag[i] == ':'))
        ++i;
    for (;;)
    {
        while (i < aTag.size() && lcl_isSpace(aTag[i]))
            ++i;
        if (i >= aTag.size())
            return std::nullopt;
        if (aTag[i] == '>' || aTag[i] == '/')
            return aAttributes;
        const size_t nName = i;
        while (i < aTag.size() && (lcl_isNCNameChar(aTag[i]) || aTag[i] == ':'))
            ++i;
        const std::string_view aName = aTag.substr(nName, i - nName);
        while (i < aTag.size() && lcl_isSpace(aTag[i]))
            ++i;
        if (aName.empty() || i >= aTag.size() || aTag[i] != '=')
            return std::nullopt;
        ++i;
        while (i < aTag.size() && lcl_isSpace(aTag[i]))
            ++i;
        if (i >= aTag.size() || (aTag[i] != '"' && aTag[i] != '\''))
            return std::nullopt;
        const size_t nClose = aTag.find(aTag[i], i + 1);
        if (nClose == std::string_view::npos)
            return std::nullopt;
        aAttributes.push_back(TagAttribute{ aName, aTag.substr(i + 1, nClose - i - 1),
                                            aTag.substr(nName, nClose + 1 - nName) });
        i = nClose + 1;
    }
}

bool lcl_isNamespaceDeclaration(std::string_view aName)
{
    return aName == "xmlns" || (aName.size() > 6 && aName.substr(0, 6) == "xmlns:");
}

/// A part's root element: the first tag that is no declaration, processing instruction or comment
struct PartRootElement
{
    std::string_view aQName;
    size_t nEnd; ///< the '>' that closes its start tag
    std::vector<TagAttribute> aAttributes;
};

/// The root element of the part aXml; none when it holds markup this reader does not follow
std::optional<PartRootElement> lcl_rootElement(std::string_view aXml)
{
    constexpr auto npos = std::string_view::npos;

    size_t nRoot = 0;
    for (;;)
    {
        nRoot = aXml.find('<', nRoot);
        if (nRoot == npos || nRoot + 1 >= aXml.size())
            return std::nullopt;
        if (aXml.substr(nRoot, 4) == "<!--")
        {
            nRoot = aXml.find("-->", nRoot);
            if (nRoot == npos)
                return std::nullopt;
        }
        else if (aXml[nRoot + 1] != '?' && aXml[nRoot + 1] != '!')
            break;
        ++nRoot;
    }
    const size_t nRootEnd = lcl_tagEnd(aXml, nRoot);
    if (nRootEnd == npos)
        return std::nullopt;
    std::optional<std::vector<TagAttribute>> oAttributes
        = lcl_tagAttributes(aXml.substr(nRoot, nRootEnd + 1 - nRoot));
    if (!oAttributes)
        return std::nullopt;
    size_t nName = nRoot + 1;
    while (nName < nRootEnd && (lcl_isNCNameChar(aXml[nName]) || aXml[nName] == ':'))
        ++nName;
    return PartRootElement{ aXml.substr(nRoot + 1, nName - nRoot - 1), nRootEnd,
                        std::move(*oAttributes) };
}

/// The namespace aPrefix stands for in rAttributes, the default one for an empty prefix
std::string_view lcl_namespaceOf(const std::vector<TagAttribute>& rAttributes,
                                 std::string_view aPrefix)
{
    for (const TagAttribute& rAttribute : rAttributes)
    {
        if (aPrefix.empty() ? rAttribute.aName == "xmlns"
                            : (rAttribute.aName.size() == aPrefix.size() + 6
                               && rAttribute.aName.substr(0, 6) == "xmlns:"
                               && rAttribute.aName.substr(6) == aPrefix))
            return rAttribute.aValue;
    }
    return std::string_view();
}

/// Strict OOXML means other namespaces, which nothing the transitional export writes can carry
bool lcl_declaresStrictNamespace(const std::vector<TagAttribute>& rAttributes)
{
    return std::any_of(rAttributes.begin(), rAttributes.end(), [](const TagAttribute& rAttribute) {
        return lcl_isNamespaceDeclaration(rAttribute.aName)
               && rAttribute.aValue.substr(0, 27) == "http://purl.oclc.org/ooxml/";
    });
}

/** Whether a part kept as its bytes can go back into the package the export writes

    The export writes Transitional OOXML, and puts a kept part back verbatim under the Transitional
    content and relationship types. So a part is kept only when its root element is in
    aRootNamespace, the Transitional namespace of that part, and it declares no Strict namespace.
    A Strict deck's part (http://purl.oclc.org/ooxml/...) is not, as lcl_standaloneTxStyles keeps
    no Strict master's styles.
*/
bool lcl_isTransitionalPart(std::string_view aXml, std::string_view aRootNamespace)
{
    const std::optional<PartRootElement> oRoot = lcl_rootElement(aXml);
    if (!oRoot)
        return false;
    const size_t nColon = oRoot->aQName.find(':');
    return lcl_namespaceOf(oRoot->aAttributes, nColon == std::string_view::npos
                                                   ? std::string_view()
                                                   : oRoot->aQName.substr(0, nColon))
               == aRootNamespace
           && !lcl_declaresStrictNamespace(oRoot->aAttributes);
}

/** The p:txStyles element of a slide master part, made standalone

    The namespace declarations of the part's root element are copied onto it, so the element stays
    well-formed, and means what it meant, inside any slide master the export writes. Empty when the
    part has none, or holds anything that could not travel intact: markup this reader does not
    follow, Strict OOXML, or a relationship id, which only the part's own relationships resolve.
*/
OString lcl_standaloneTxStyles(std::string_view aXml)
{
    constexpr auto npos = std::string_view::npos;

    const std::optional<PartRootElement> oRootElement = lcl_rootElement(aXml);
    if (!oRootElement)
        return OString();
    const size_t nRootEnd = oRootElement->nEnd;
    const std::vector<TagAttribute>& rRoot = oRootElement->aAttributes;
    // A comment, CDATA section or processing instruction could hold what reads as a tag below.
    // Neither PowerPoint nor python-pptx writes one in a slide master.
    if (aXml.find("<!", nRootEnd) != npos || aXml.find("<?", nRootEnd) != npos)
        return OString();

    // The txStyles start tag, under whatever prefix the part gives presentationML
    size_t nStart = npos;
    std::string_view aQName;
    for (size_t n = aXml.find("txStyles", nRootEnd); n != npos; n = aXml.find("txStyles", n + 1))
    {
        const size_t nAfter = n + 8;
        if (nAfter >= aXml.size()
            || !(lcl_isSpace(aXml[nAfter]) || aXml[nAfter] == '>' || aXml[nAfter] == '/'))
            continue;
        size_t nQName = n;
        if (aXml[n - 1] == ':')
        {
            nQName = n - 1;
            while (nQName > 0 && lcl_isNCNameChar(aXml[nQName - 1]))
                --nQName;
            if (nQName == n - 1)
                continue; // an empty prefix
        }
        if (nQName == 0 || aXml[nQName - 1] != '<')
            continue; // a closing tag, or the name inside text or an attribute
        nStart = nQName - 1;
        aQName = aXml.substr(nQName, nAfter - nQName);
        break;
    }
    if (nStart == npos)
        return OString();
    const size_t nColon = aQName.find(':');
    if (lcl_namespaceOf(rRoot, nColon == npos ? std::string_view() : aQName.substr(0, nColon))
        != "http://schemas.openxmlformats.org/presentationml/2006/main")
        return OString();

    const size_t nStartEnd = lcl_tagEnd(aXml, nStart);
    if (nStartEnd == npos)
        return OString();
    const std::optional<std::vector<TagAttribute>> oOwn
        = lcl_tagAttributes(aXml.substr(nStart, nStartEnd + 1 - nStart));
    if (!oOwn)
        return OString();
    size_t nEnd = nStartEnd + 1;
    if (aXml[nStartEnd - 1] != '/')
    {
        for (size_t nClose = aXml.find("</", nStartEnd);; nClose = aXml.find("</", nClose + 2))
        {
            if (nClose == npos)
                return OString();
            if (aXml.substr(nClose + 2, aQName.size()) != aQName)
                continue;
            size_t i = nClose + 2 + aQName.size();
            while (i < aXml.size() && lcl_isSpace(aXml[i]))
                ++i;
            if (i < aXml.size() && aXml[i] == '>')
            {
                nEnd = i + 1;
                break;
            }
        }
    }
    const std::string_view aElement = aXml.substr(nStart, nEnd - nStart);

    // Strict OOXML means other namespaces, which no transitional master can carry
    if (lcl_declaresStrictNamespace(rRoot))
        return OString();
    for (const TagAttribute& rAttribute : rRoot)
    {
        if (!lcl_isNamespaceDeclaration(rAttribute.aName))
            continue;
        // A relationship id (a picture bullet's r:embed) names this part's relationships
        if (rAttribute.aValue == "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            && rAttribute.aName.size() > 6
            && aElement.find(std::string(rAttribute.aName.substr(6)) + ":") != npos)
            return OString();
    }

    OStringBuffer aOut;
    aOut.append('<');
    aOut.append(aQName);
    for (const TagAttribute& rAttribute : rRoot)
    {
        if (!lcl_isNamespaceDeclaration(rAttribute.aName)
            || std::any_of(oOwn->begin(), oOwn->end(), [&rAttribute](const TagAttribute& rOwn) {
                   return rOwn.aName == rAttribute.aName;
               }))
            continue;
        aOut.append(' ');
        aOut.append(rAttribute.aText);
    }
    aOut.append(aElement.substr(1 + aQName.size()));
    return aOut.makeStringAndClear();
}

/** Keeps what the deck holds that no part of the document model does, for the export

    "OOXTableStyles" and "OOXViewProps" hold the bytes of those parts. "OOXMasterTxStyles" holds,
    for each Impress master page in order, its name and the standalone p:txStyles of the slide
    master it was imported from (all the layouts of one slide master share them).
*/
void lcl_keepUnmodelledParts(PowerPointImport& rFilter, const OUString& rTableStylesPath,
                             const OUString& rViewPropsPath)
{
    try
    {
        Reference<beans::XPropertySet> xDocProps(rFilter.getModel(), UNO_QUERY);
        if (!xDocProps.is()
            || !xDocProps->getPropertySetInfo()->hasPropertyByName(u"InteropGrabBag"_ustr))
            return;
        comphelper::SequenceAsHashMap aGrabBag(xDocProps->getPropertyValue(u"InteropGrabBag"_ustr));

        // A part with relationships of its own (a picture fill in a table style) would come back
        // without them, its references dangling, so such a part is not kept. Nor is a Strict
        // deck's part, which would come back under Transitional types (lcl_isTransitionalPart).
        auto keepPart = [&rFilter, &aGrabBag](const OUString& rPath, const OUString& rKey,
                                              std::string_view aRootNamespace) {
            if (rPath.isEmpty())
                return;
            RelationsRef xRelations = rFilter.importRelations(rPath);
            if (xRelations && xRelations->size() > 0)
                return;
            StreamDataSequence aBytes;
            if (rFilter.importBinaryData(aBytes, rPath)
                && lcl_isTransitionalPart(
                    std::string_view(reinterpret_cast<const char*>(aBytes.getConstArray()),
                                     aBytes.getLength()),
                    aRootNamespace))
                aGrabBag[rKey] <<= aBytes;
        };
        keepPart(rTableStylesPath, u"OOXTableStyles"_ustr,
                 "http://schemas.openxmlformats.org/drawingml/2006/main");
        keepPart(rViewPropsPath, u"OOXViewProps"_ustr,
                 "http://schemas.openxmlformats.org/presentationml/2006/main");

        Reference<drawing::XMasterPagesSupplier> xMPS(rFilter.getModel(), UNO_QUERY_THROW);
        Reference<drawing::XDrawPages> xMasterPages(xMPS->getMasterPages(), UNO_SET_THROW);
        std::map<OUString, OUString> aStylesOfPart; // read once for all the layouts of a master
        std::vector<beans::PropertyValue> aTxStyles;
        bool bAnyTxStyles = false;
        for (sal_Int32 nPage = 0; nPage < xMasterPages->getCount(); ++nPage)
        {
            Reference<drawing::XDrawPage> xPage;
            xMasterPages->getByIndex(nPage) >>= xPage;
            OUString aName;
            if (Reference<container::XNamed> xNamed{ xPage, UNO_QUERY })
                aName = xNamed->getName();

            OUString aStyles;
            for (const SlidePersistPtr& pPersist : rFilter.getMasterPages())
            {
                if (!pPersist || pPersist->isNotesPage() || pPersist->getPage() != xPage)
                    continue;
                const OUString& rPath = pPersist->getPath();
                auto aIt = aStylesOfPart.find(rPath);
                if (aIt == aStylesOfPart.end())
                {
                    OUString aPartStyles;
                    StreamDataSequence aBytes;
                    if (!rPath.isEmpty() && rFilter.importBinaryData(aBytes, rPath))
                        aPartStyles = OStringToOUString(
                            lcl_standaloneTxStyles(std::string_view(
                                reinterpret_cast<const char*>(aBytes.getConstArray()),
                                aBytes.getLength())),
                            RTL_TEXTENCODING_UTF8);
                    aIt = aStylesOfPart.emplace(rPath, aPartStyles).first;
                }
                aStyles = aIt->second;
                break;
            }
            bAnyTxStyles = bAnyTxStyles || !aStyles.isEmpty();
            aTxStyles.push_back(comphelper::makePropertyValue(aName, aStyles));
        }
        if (bAnyTxStyles)
            aGrabBag[u"OOXMasterTxStyles"_ustr] <<= comphelper::containerToSequence(aTxStyles);

        xDocProps->setPropertyValue(u"InteropGrabBag"_ustr,
                                    Any(aGrabBag.getAsConstPropertyValueList()));
    }
    catch (const Exception&)
    {
        TOOLS_WARN_EXCEPTION("oox", "PowerPointImport: cannot keep the parts the model does not hold");
    }
}

}

bool PowerPointImport::importDocument()
{
    /*  to activate the PPTX dumper, define the environment variable
        OOO_PPTXDUMPER and insert the full path to the file
        file:///<path-to-oox-module>/source/dump/pptxdumper.ini. */
    OOX_DUMP_FILE( ::oox::dump::pptx::Dumper );

    uno::Reference< document::XUndoManagerSupplier > xUndoManagerSupplier (getModel(), UNO_QUERY );
    uno::Reference< util::XLockable > xUndoManager;
    bool bWasUnLocked = true;
    if(xUndoManagerSupplier.is())
    {
        xUndoManager = xUndoManagerSupplier->getUndoManager();
        if(xUndoManager.is())
        {
            // VULCAN: lock only when this unlocks below. isLocked() reads whether
            // recording is off, not this lock's count, and DrawDocShell::ImportFrom has already
            // turned recording off for a first load, so every load left one lock behind. Only
            // the first lock turns recording off, so the export's own lock (filter, below) never
            // did, and the temporary slide a one-layout master is written from was recorded as
            // "Delete slides": after every save in the editing kit, the person's next Undo
            // brought back an empty last slide instead of taking back their edit.
            bWasUnLocked = !xUndoManager->isLocked();
            if (bWasUnLocked)
                xUndoManager->lock();
        }
    }

    importDocumentProperties();

    OUString aFragmentPath = getFragmentPathFromFirstTypeFromOfficeDoc( u"officeDocument" );
    FragmentHandlerRef xPresentationFragmentHandler( new PresentationFragmentHandler( *this, aFragmentPath ) );
    maTableStyleListPath = xPresentationFragmentHandler->getFragmentPathFromFirstTypeFromOfficeDoc( u"tableStyles" );
    const OUString sPresPropsPath
        = xPresentationFragmentHandler->getFragmentPathFromFirstTypeFromOfficeDoc(u"presProps");

    bool bRet = importFragment(xPresentationFragmentHandler);
    if (bRet && !sPresPropsPath.isEmpty())
    {
        FragmentHandlerRef xPresPropsFragmentHandler(
            new PresPropsFragmentHandler(*this, sPresPropsPath));
        importFragment(xPresPropsFragmentHandler);
    }
    if (bRet)
        lcl_keepUnmodelledParts(
            *this, maTableStyleListPath,
            xPresentationFragmentHandler->getFragmentPathFromFirstTypeFromOfficeDoc(u"viewProps"));

    static bool bNoSmartartWarning = getenv("OOX_NO_SMARTART_WARNING");
    if (!bNoSmartartWarning && mbMissingExtDrawing)
    {
        // Construct a warning message.
        INetURLObject aURL(getFileUrl());
        SfxErrorContext aContext(ERRCTX_SFX_OPENDOC, aURL.getName(INetURLObject::LAST_SEGMENT, true, INetURLObject::DecodeMechanism::WithCharset), nullptr, RID_ERRCTX);
        OUString aWarning;
        aContext.GetString(ERRCODE_NONE.MakeWarning(), aWarning);
        aWarning += ":\n" + SvxResId(RID_SVXSTR_WARN_MISSING_SMARTART);

        // Show it.
        std::unique_ptr<weld::MessageDialog> xWarn(Application::CreateMessageDialog(nullptr,
                                                   VclMessageType::Warning, VclButtonsType::Ok,
                                                   aWarning));
        xWarn->run();
    }

    if(xUndoManager.is() && bWasUnLocked)
        xUndoManager->unlock();

    return bRet;

}

bool PowerPointImport::exportDocument() noexcept
{
    return false;
}

void PowerPointImport::getSchemeColorToken(sal_Int32& nToken) const
{
    if (mpActualSlidePersist)
    {
        bool bColorMapped = false;
        oox::drawingml::ClrMapPtr pClrMapPtr(mpActualSlidePersist->getClrMap());
        if (pClrMapPtr)
            bColorMapped = pClrMapPtr->getColorMap(nToken);

        if (!bColorMapped)    // try masterpage mapping
        {
            SlidePersistPtr pMasterPersist = mpActualSlidePersist->getMasterPersist();
            if (pMasterPersist)
            {
                pClrMapPtr = pMasterPersist->getClrMap();
                if (pClrMapPtr)
                    pClrMapPtr->getColorMap(nToken);
            }
        }
    }
}

::Color PowerPointImport::getSchemeColor( sal_Int32 nToken ) const
{
    ::Color nColor;
    if ( mpActualSlidePersist )
    {
        bool bColorMapped = false;
        oox::drawingml::ClrMapPtr pClrMapPtr( mpActualSlidePersist->getClrMap() );
        if ( pClrMapPtr )
            bColorMapped = pClrMapPtr->getColorMap( nToken );

        if ( !bColorMapped )    // try masterpage mapping
        {
            SlidePersistPtr pMasterPersist = mpActualSlidePersist->getMasterPersist();
            if ( pMasterPersist )
            {
                pClrMapPtr = pMasterPersist->getClrMap();
                if ( pClrMapPtr )
                    pClrMapPtr->getColorMap( nToken );
            }
        }

        ::oox::drawingml::ThemePtr pTheme = mpActualSlidePersist->getTheme();
        if( pTheme )
        {
            pTheme->getClrScheme().getColor( nToken, nColor );
        }
        else
        {
            SAL_WARN("oox", "OOX: PowerPointImport::mpThemePtr is NULL");
        }
    }
    return nColor;
}

const ::oox::drawingml::Theme* PowerPointImport::getCurrentTheme() const
{
    return mpActualSlidePersist ? mpActualSlidePersist->getTheme().get() : nullptr;
}

std::shared_ptr<::oox::drawingml::Theme> PowerPointImport::getCurrentThemePtr() const
{
    return mpActualSlidePersist ? mpActualSlidePersist->getTheme() : std::shared_ptr<::oox::drawingml::Theme>();
}

bool SAL_CALL PowerPointImport::filter( const Sequence< PropertyValue >& rDescriptor )
{
    if( XmlFilterBase::filter( rDescriptor ) )
        return true;

    if (isExportFilter())
    {
        cpo::uno::Sequence<cpo::uno::Any> aArguments(comphelper::InitAnyPropertySequence(
        {
            {"IsPPTM", cpo::uno::Any(exportVBA())},
            {"IsTemplate", cpo::uno::Any(isExportTemplate())},
            {"IsSlideShow", cpo::uno::Any(isExportSlideShow())},
        }));

        Reference<css::lang::XMultiServiceFactory> aFactory(getComponentContext()->getServiceManager(), UNO_QUERY_THROW);
        Reference< XExporter > xExporter(aFactory->createInstanceWithArguments(u"com.sun.star.comp.Impress.oox.PowerPointExport"_ustr, aArguments), UNO_QUERY);

        if (Reference<XFilter> xFilter{ xExporter, UNO_QUERY })
        {
            Reference<util::XLockable> xUndoManager;
            bool bWasUnLocked = true;
            if (Reference<document::XUndoManagerSupplier> xUMS{ getModel(), UNO_QUERY })
            {
                xUndoManager = xUMS->getUndoManager();
                if (xUndoManager.is())
                {
                    bWasUnLocked = !xUndoManager->isLocked();
                    xUndoManager->lock();
                }
            }
            comphelper::ScopeGuard aGuard([xUndoManager, bWasUnLocked] {
                if (xUndoManager && bWasUnLocked)
                    xUndoManager->unlock();
            });

            Reference< XComponent > xDocument = getModel();
            xExporter->setSourceDocument(xDocument);
            if (xFilter->filter(rDescriptor))
                return true;
        }
    }

    return false;
}

::oox::vml::Drawing* PowerPointImport::getVmlDrawing()
{
    return mpActualSlidePersist ? mpActualSlidePersist->getDrawing() : nullptr;
}

oox::drawingml::table::TableStyleListPtr PowerPointImport::getTableStyles()
{
    if ( !mpTableStyleList && !maTableStyleListPath.isEmpty() )
    {
        mpTableStyleList = std::make_shared<oox::drawingml::table::TableStyleList>( );
        importFragment( new oox::drawingml::table::TableStyleListFragmentHandler(
            *this, maTableStyleListPath, *mpTableStyleList ) );
    }
    return mpTableStyleList;
}

::oox::drawingml::chart::ChartConverter* PowerPointImport::getChartConverter()
{
    return mxChartConv.get();
}

namespace {

class PptGraphicHelper : public GraphicHelper
{
public:
    explicit            PptGraphicHelper( const PowerPointImport& rFilter );
    virtual ::Color     getSchemeColor( sal_Int32 nToken ) const override;
    virtual void        getSchemeColorToken( sal_Int32& nToken ) const override;
    virtual sal_Int32   getDefaultChartAreaFillStyle() const override;
private:
    const PowerPointImport& mrFilter;
};

PptGraphicHelper::PptGraphicHelper( const PowerPointImport& rFilter ) :
    GraphicHelper( rFilter.getComponentContext(), rFilter.getTargetFrame(), rFilter.getStorage() ),
    mrFilter( rFilter )
{
}

void PptGraphicHelper::getSchemeColorToken(sal_Int32& nToken) const
{
    return mrFilter.getSchemeColorToken(nToken);
}

::Color PptGraphicHelper::getSchemeColor( sal_Int32 nToken ) const
{
    return mrFilter.getSchemeColor( nToken );
}

sal_Int32 PptGraphicHelper::getDefaultChartAreaFillStyle() const
{
    return XML_noFill;
}

} // namespace

GraphicHelper* PowerPointImport::implCreateGraphicHelper() const
{
    return new PptGraphicHelper( *this );
}

::oox::ole::VbaProject* PowerPointImport::implCreateVbaProject() const
{
    return new ::oox::ole::VbaProject( getComponentContext(), getModel(), u"Impress" );
}

OUString PowerPointImport::getImplementationName()
{
    return u"com.sun.star.comp.oox.ppt.PowerPointImport"_ustr;
}

}

extern "C" SAL_DLLPUBLIC_EXPORT uno::XInterface*
com_sun_star_comp_oox_ppt_PowerPointImport_get_implementation(
    uno::XComponentContext* pCtx, cpo::uno::Sequence<cpo::uno::Any> const& /*rSeq*/)
{
    return cppu::acquire(new oox::ppt::PowerPointImport(pCtx));
}

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
