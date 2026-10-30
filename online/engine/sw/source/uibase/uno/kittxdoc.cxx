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

#include <unotxdoc.hxx>

#include <algorithm>
#include <map>
#include <utility>
#include <vector>

#include <com/sun/star/beans/XPropertyAccess.hpp>

#include <comphelper/diagnose_ex.hxx>
#include <comphelper/sequence.hxx>
#include <o3tl/string_view.hxx>
#include <tools/json_writer.hxx>
#include <tools/stream.hxx>
#include <tools/urlobj.hxx>
#include <xmloff/odffields.hxx>
#include <sfx2/kit/helper.hxx>

#include <IDocumentLayoutAccess.hxx>
#include <IDocumentLinksAdministration.hxx>
#include <IDocumentMarkAccess.hxx>
#include <IDocumentRedlineAccess.hxx>
#include <IDocumentState.hxx>
#include <IDocumentUndoRedo.hxx>
#include <doc.hxx>
#include <docsh.hxx>
#include <fmtrfmrk.hxx>
#include <ndarr.hxx>
#include <section.hxx>
#include <shellio.hxx>
#include <unocrsr.hxx>
#include <unocrsrhelper.hxx>
#include <wrtsh.hxx>
#include <txtrfmrk.hxx>
#include <ndtxt.hxx>
#include <redline.hxx>
#include <unoredline.hxx>
#include <unoredlines.hxx>

#include <unoport.hxx>
#include <unoprnms.hxx>
#include <unocontentcontrol.hxx>
#include <rootfrm.hxx>
#include <pagefrm.hxx>
#include <sortedobjs.hxx>
#include <anchoredobject.hxx>
#include <com/sun/star/text/XTextContent.hpp>

#include <com/sun/star/text/XTextEmbeddedObjectsSupplier.hpp>
#include <com/sun/star/chart2/XInternalDataProvider.hpp>
#include <com/sun/star/chart2/XChartDocument.hpp>
#include <com/sun/star/chart/XChartDocument.hpp>
#include <com/sun/star/chart/XChartDataArray.hpp>
#include <com/sun/star/chart2/XTitle.hpp>
#include <com/sun/star/chart2/XTitled.hpp>
#include <com/sun/star/document/XDocumentProperties2.hpp>
#include <com/sun/star/document/XDocumentPropertiesSupplier.hpp>
#include <com/sun/star/document/XLinkTargetSupplier.hpp>
#include <com/sun/star/lang/XServiceInfo.hpp>
#include <com/sun/star/container/XNameAccess.hpp>

#include <sax/tools/converter.hxx>

using namespace ::com::sun::star;

namespace
{
// A helper class to make it easier to put UNO property values to JSON with a given name.
// Removes noise from code.
class PropertyExtractor
{
public:
    PropertyExtractor(const uno::Reference<beans::XPropertySet>& xProperties,
                      tools::JsonWriter& rWriter)
        : m_xProperties(xProperties)
        , m_rWriter(rWriter)
    {
    }

    template <typename T> void extract(const OUString& unoName, std::string_view jsonName)
    {
        if (T val; m_xProperties->getPropertyValue(unoName) >>= val)
        {
            if constexpr (std::is_same_v<T, util::DateTime>)
            {
                OUStringBuffer buf(32);
                sax::Converter::convertDateTime(buf, val, nullptr, true);
                m_rWriter.put(jsonName, buf.makeStringAndClear());
            }
            else
                m_rWriter.put(jsonName, val);
        }
    }

private:
    uno::Reference<beans::XPropertySet> m_xProperties;
    tools::JsonWriter& m_rWriter;
};

/// Implements getCommandValues(".uno:TextFormFields").
///
/// Parameters:
///
/// - type: e.g. ODF_UNHANDLED
/// - commandPrefix: field command prefix to not return all fieldmarks
void GetTextFormFields(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell,
                       const std::map<OUString, OUString>& rArguments)
{
    OUString aType;
    OUString aCommandPrefix;
    {
        auto it = rArguments.find(u"type"_ustr);
        if (it != rArguments.end())
        {
            aType = it->second;
        }

        it = rArguments.find(u"commandPrefix"_ustr);
        if (it != rArguments.end())
        {
            aCommandPrefix = it->second;
        }
    }

    SwDoc* pDoc = pDocShell->GetDoc();
    IDocumentMarkAccess* pMarkAccess = pDoc->getIDocumentMarkAccess();
    auto aFields = rJsonWriter.startArray("fields");
    for (auto it = pMarkAccess->getFieldmarksBegin(); it != pMarkAccess->getFieldmarksEnd(); ++it)
    {
        sw::mark::Fieldmark* pFieldmark = *it;
        assert(pFieldmark);
        if (pFieldmark->GetFieldname() != aType)
        {
            continue;
        }

        auto itParam = pFieldmark->GetParameters()->find(ODF_CODE_PARAM);
        if (itParam == pFieldmark->GetParameters()->end())
        {
            continue;
        }

        OUString aCommand;
        itParam->second >>= aCommand;
        if (!aCommand.startsWith(aCommandPrefix))
        {
            continue;
        }

        auto aField = rJsonWriter.startStruct();
        rJsonWriter.put("type", aType);
        rJsonWriter.put("command", aCommand);
    }
}

/// Implements getCommandValues(".uno:TextFormField").
///
/// Parameters:
///
/// - type: e.g. ODF_UNHANDLED
/// - commandPrefix: field command prefix to not return all fieldmarks
void GetTextFormField(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell,
                      const std::map<OUString, OUString>& rArguments)
{
    OUString aType;
    OUString aCommandPrefix;
    auto it = rArguments.find(u"type"_ustr);
    if (it != rArguments.end())
    {
        aType = it->second;
    }

    it = rArguments.find(u"commandPrefix"_ustr);
    if (it != rArguments.end())
    {
        aCommandPrefix = it->second;
    }

    IDocumentMarkAccess& rIDMA = *pDocShell->GetDoc()->getIDocumentMarkAccess();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    SwPosition& rCursor = *pWrtShell->GetCursor()->GetPoint();
    sw::mark::Fieldmark* pFieldmark = rIDMA.getInnerFieldmarkFor(rCursor);
    auto typeNode = rJsonWriter.startNode("field");
    if (!pFieldmark)
    {
        return;
    }

    if (pFieldmark->GetFieldname() != aType)
    {
        return;
    }

    auto itParam = pFieldmark->GetParameters()->find(ODF_CODE_PARAM);
    if (itParam == pFieldmark->GetParameters()->end())
    {
        return;
    }

    OUString aCommand;
    itParam->second >>= aCommand;
    if (!aCommand.startsWith(aCommandPrefix))
    {
        return;
    }

    rJsonWriter.put("type", aType);
    rJsonWriter.put("command", aCommand);
}

/// Implements getCommandValues(".uno:SetDocumentProperties").
///
/// Parameters:
///
/// - namePrefix: field name prefix to not return all user-defined properties
void GetDocumentProperties(tools::JsonWriter& rJsonWriter, const SwDocShell* pDocShell,
                           const std::map<OUString, OUString>& rArguments)
{
    OUString aNamePrefix;
    auto it = rArguments.find(u"namePrefix"_ustr);
    if (it != rArguments.end())
    {
        aNamePrefix = it->second;
    }

    uno::Reference<document::XDocumentPropertiesSupplier> xDPS(pDocShell->GetModel(),
                                                               uno::UNO_QUERY);
    uno::Reference<document::XDocumentProperties> xDP = xDPS->getDocumentProperties();
    uno::Reference<beans::XPropertyAccess> xUDP(xDP->getUserDefinedProperties(), uno::UNO_QUERY);
    auto aUDPs = comphelper::sequenceToContainer<std::vector<beans::PropertyValue>>(
        xUDP->getPropertyValues());
    auto aProperties = rJsonWriter.startArray("userDefinedProperties");
    for (const auto& rUDP : aUDPs)
    {
        if (!rUDP.Name.startsWith(aNamePrefix))
        {
            continue;
        }

        if (rUDP.Value.getValueTypeClass() != uno::TypeClass_STRING)
        {
            continue;
        }

        OUString aValue;
        rUDP.Value >>= aValue;

        auto aProperty = rJsonWriter.startStruct();
        rJsonWriter.put("name", rUDP.Name);
        rJsonWriter.put("type", "string");
        rJsonWriter.put("value", aValue);
    }
}

/// Implements getCommandValues(".uno:Bookmarks").
///
/// Parameters:
///
/// - namePrefix: bookmark name prefix to not return all bookmarks
void GetBookmarks(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell,
                  const std::map<OUString, OUString>& rArguments)
{
    OUString aNamePrefix;
    {
        auto it = rArguments.find(u"namePrefix"_ustr);
        if (it != rArguments.end())
        {
            aNamePrefix = it->second;
        }
    }

    IDocumentMarkAccess& rIDMA = *pDocShell->GetDoc()->getIDocumentMarkAccess();
    auto aBookmarks = rJsonWriter.startArray("bookmarks");
    for (auto it = rIDMA.getBookmarksBegin(); it != rIDMA.getBookmarksEnd(); ++it)
    {
        sw::mark::MarkBase* pMark = *it;
        if (!pMark->GetName().toString().startsWith(aNamePrefix))
        {
            continue;
        }

        auto aProperty = rJsonWriter.startStruct();
        rJsonWriter.put("name", pMark->GetName().toString());
    }
}

/// Implements getCommandValues(".uno:Bookmark").
///
/// Parameters:
///
/// - namePrefix: bookmark name prefix to not return all bookmarks
void GetBookmark(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell,
                 const std::map<OUString, OUString>& rArguments)
{
    OUString aNamePrefix;
    {
        auto it = rArguments.find(u"namePrefix"_ustr);
        if (it != rArguments.end())
        {
            aNamePrefix = it->second;
        }
    }

    IDocumentMarkAccess& rIDMA = *pDocShell->GetDoc()->getIDocumentMarkAccess();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    SwPosition& rCursor = *pWrtShell->GetCursor()->GetPoint();
    sw::mark::MarkBase* pBookmark = rIDMA.getOneInnermostBookmarkFor(rCursor);
    auto aBookmark = rJsonWriter.startNode("bookmark");
    if (!pBookmark)
    {
        return;
    }

    if (!pBookmark->GetName().toString().startsWith(aNamePrefix))
    {
        return;
    }

    rJsonWriter.put("name", pBookmark->GetName().toString());
}

/// Implements getCommandValues(".uno:Fields").
///
/// Parameters:
///
/// - typeName: field type condition to not return all fields
/// - namePrefix: field name prefix to not return all fields
void GetFields(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell,
               const std::map<OUString, OUString>& rArguments)
{
    OUString aTypeName;
    {
        auto it = rArguments.find(u"typeName"_ustr);
        if (it != rArguments.end())
        {
            aTypeName = it->second;
        }
    }
    // See SwFieldTypeFromString().
    if (aTypeName != "SetRef")
    {
        return;
    }

    OUString aNamePrefix;
    {
        auto it = rArguments.find(u"namePrefix"_ustr);
        if (it != rArguments.end())
        {
            aNamePrefix = it->second;
        }
    }

    SwDoc* pDoc = pDocShell->GetDoc();
    auto aBookmarks = rJsonWriter.startArray("setRefs");
    std::vector<const SwFormatRefMark*> aRefMarks;
    for (sal_uInt16 i = 0; i < pDoc->GetRefMarks(); ++i)
    {
        aRefMarks.push_back(pDoc->GetRefMark(i));
    }
    // Sort the refmarks based on their start position.
    std::sort(aRefMarks.begin(), aRefMarks.end(),
              [](const SwFormatRefMark* pMark1, const SwFormatRefMark* pMark2) -> bool {
                  const SwTextRefMark* pTextRefMark1 = pMark1->GetTextRefMark();
                  const SwTextRefMark* pTextRefMark2 = pMark2->GetTextRefMark();
                  SwPosition aPos1(pTextRefMark1->GetTextNode(), pTextRefMark1->GetStart());
                  SwPosition aPos2(pTextRefMark2->GetTextNode(), pTextRefMark2->GetStart());
                  return aPos1 < aPos2;
              });

    for (const auto& pRefMark : aRefMarks)
    {
        if (!pRefMark->GetRefName().toString().startsWith(aNamePrefix))
        {
            continue;
        }

        auto aProperty = rJsonWriter.startStruct();
        rJsonWriter.put("name", pRefMark->GetRefName().toString());
    }
}

/// Implements getCommandValues(".uno:Layout").
void GetLayout(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell)
{
    rJsonWriter.put("commandName", ".uno:Layout");
    auto aCommandValues = rJsonWriter.startNode("commandValues");
    auto aPages = rJsonWriter.startArray("pages");
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    SwRootFrame* pLayout = pWrtShell->GetLayout();
    for (SwFrame* pFrame = pLayout->GetLower(); pFrame; pFrame = pFrame->GetNext())
    {
        auto pPage = pFrame->DynCastPageFrame();
        auto aPage = rJsonWriter.startStruct();
        rJsonWriter.put("isInvalidContent", pPage->IsInvalidContent());
    }
}

void UnionContentExtent(const SwFrame& rFrame, SwRect& rExtent)
{
    rExtent.Union(rFrame.getFrameArea());
    // A table's indents, and a paragraph's negative ones, put its print area outside its frame.
    SwRect aPrintArea(rFrame.getFramePrintArea());
    aPrintArea += rFrame.getFrameArea().Pos();
    rExtent.Union(aPrintArea);
    if (const SwSortedObjs* pObjs = rFrame.GetDrawObjs())
        for (const SwAnchoredObject* pObj : *pObjs)
            rExtent.Union(pObj->GetObjRect());
    if (!rFrame.IsLayoutFrame() || rFrame.IsTabFrame())
        return;
    for (const SwFrame* pLower = static_cast<const SwLayoutFrame&>(rFrame).Lower(); pLower;
         pLower = pLower->GetNext())
        UnionContentExtent(*pLower, rExtent);
}

/// Implements getCommandValues(".uno:ContentExtent"): per page, [top, bottom, left, right] in
/// twips, where left and right bound the body text, the tables and the objects on that page.
void GetContentExtent(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell)
{
    rJsonWriter.put("commandName", ".uno:ContentExtent");
    auto aCommandValues = rJsonWriter.startNode("commandValues");
    auto aPages = rJsonWriter.startArray("pages");
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    if (!pWrtShell)
        return;
    for (const SwFrame* pFrame = pWrtShell->GetLayout()->Lower(); pFrame; pFrame = pFrame->GetNext())
    {
        const SwPageFrame* pPage = pFrame->DynCastPageFrame();
        if (!pPage)
            continue;
        SwRect aExtent;
        if (const SwLayoutFrame* pBody = pPage->FindBodyCont())
            UnionContentExtent(*pBody, aExtent);
        // At-page, at-paragraph and at-character objects; as-character ones are the paragraph's.
        if (const SwSortedObjs* pObjs = pPage->GetSortedObjs())
            for (const SwAnchoredObject* pObj : *pObjs)
                aExtent.Union(pObj->GetObjRect());
        if (aExtent.IsEmpty())
            continue;
        auto aPage = rJsonWriter.startAnonArray();
        rJsonWriter.putSimpleValue(pPage->getFrameArea().Top());
        rJsonWriter.putSimpleValue(pPage->getFrameArea().Bottom());
        rJsonWriter.putSimpleValue(aExtent.Left());
        rJsonWriter.putSimpleValue(aExtent.Right());
    }
}

/// Implements getCommandValues(".uno:Field").
///
/// Parameters:
///
/// - typeName: field type condition to not return all fields
/// - namePrefix: field name prefix to not return all fields
void GetField(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell,
              const std::map<OUString, OUString>& rArguments)
{
    OUString aTypeName;
    {
        auto it = rArguments.find(u"typeName"_ustr);
        if (it != rArguments.end())
        {
            aTypeName = it->second;
        }
    }
    // See SwFieldTypeFromString().
    if (aTypeName != "SetRef")
    {
        return;
    }

    OUString aNamePrefix;
    {
        auto it = rArguments.find(u"namePrefix"_ustr);
        if (it != rArguments.end())
        {
            aNamePrefix = it->second;
        }
    }

    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    SwPosition& rCursor = *pWrtShell->GetCursor()->GetPoint();
    SwTextNode* pTextNode = rCursor.GetNode().GetTextNode();
    std::vector<SwTextAttr*> aAttrs
        = pTextNode->GetTextAttrsAt(rCursor.GetContentIndex(), RES_TXTATR_REFMARK);
    auto aRefmark = rJsonWriter.startNode("setRef");
    if (aAttrs.empty())
    {
        return;
    }

    const SwFormatRefMark& rRefmark = aAttrs[0]->GetRefMark();
    if (!rRefmark.GetRefName().toString().startsWith(aNamePrefix))
    {
        return;
    }

    rJsonWriter.put("name", rRefmark.GetRefName().toString());
}

/// Implements getCommandValues(".uno:ExtractDocumentStructures") for content controls
void GetDocStructureContentControls(tools::JsonWriter& rJsonWriter, const SwDocShell* pDocShell)
{
    uno::Reference<container::XIndexAccess> xContentControls
        = pDocShell->GetBaseModel()->getContentControls();
    if (!xContentControls)
        return;

    int iCCcount = xContentControls->getCount();

    for (int i = 0; i < iCCcount; ++i)
    {
        OString aNodeName("ContentControls.ByIndex."_ostr + OString::number(i));
        auto ContentControlNode = rJsonWriter.startNode(aNodeName);

        uno::Reference<text::XTextContent> xContentControl;

        xContentControls->getByIndex(i) >>= xContentControl;

        uno::Reference<text::XText> xContentControlText(xContentControl, uno::UNO_QUERY);
        uno::Reference<beans::XPropertySet> xContentControlProps(xContentControl, uno::UNO_QUERY);

        sal_Int32 iID = -1;
        xContentControlProps->getPropertyValue(UNO_NAME_ID) >>= iID;
        rJsonWriter.put("id", iID);

        OUString aTag;
        xContentControlProps->getPropertyValue(UNO_NAME_TAG) >>= aTag;
        rJsonWriter.put("tag", aTag);

        OUString aAlias;
        xContentControlProps->getPropertyValue(UNO_NAME_ALIAS) >>= aAlias;
        rJsonWriter.put("alias", aAlias);

        sal_Int32 iType(0);
        xContentControlProps->getPropertyValue(UNO_NAME_CONTENT_CONTROL_TYPE) >>= iType;
        SwContentControlType aType = static_cast<SwContentControlType>(iType);

        bool bShowingPlaceHolder = false;
        xContentControlProps->getPropertyValue(UNO_NAME_SHOWING_PLACE_HOLDER)
            >>= bShowingPlaceHolder;
        OUString aContent;
        if (!bShowingPlaceHolder)
        {
            aContent = xContentControlText->getString();
        }
        rJsonWriter.put("content", aContent);

        switch (aType)
        {
            case SwContentControlType::RICH_TEXT:
            {
                rJsonWriter.put("type", "rich-text");
            }
            break;
            case SwContentControlType::CHECKBOX:
            {
                rJsonWriter.put("type", "checkbox");
                bool bchecked = false;
                xContentControlProps->getPropertyValue(UNO_NAME_CHECKED) >>= bchecked;
                rJsonWriter.put(UNO_NAME_CHECKED, OUString::boolean(bchecked));
            }
            break;
            case SwContentControlType::DROP_DOWN_LIST:
            {
                rJsonWriter.put("type", "drop-down-list");
                // we could list its elements if we want
            }
            break;
            case SwContentControlType::PICTURE:
            {
                rJsonWriter.put("type", "picture");
            }
            break;
            case SwContentControlType::DATE:
            {
                rJsonWriter.put("type", "date");
                OUString aDateFormat;
                xContentControlProps->getPropertyValue(UNO_NAME_DATE_FORMAT) >>= aDateFormat;
                rJsonWriter.put(UNO_NAME_DATE_FORMAT, aDateFormat);
                OUString aDateLanguage;
                xContentControlProps->getPropertyValue(UNO_NAME_DATE_LANGUAGE) >>= aDateLanguage;
                rJsonWriter.put(UNO_NAME_DATE_LANGUAGE, aDateLanguage);
                OUString aCurrentDate;
                xContentControlProps->getPropertyValue(UNO_NAME_CURRENT_DATE) >>= aCurrentDate;
                rJsonWriter.put(UNO_NAME_CURRENT_DATE, aCurrentDate);
            }
            break;
            case SwContentControlType::PLAIN_TEXT:
            {
                rJsonWriter.put("type", "plain-text");
            }
            break;
            case SwContentControlType::COMBO_BOX:
            {
                rJsonWriter.put("type", "combo-box");
                // we could list its elements if we want
            }
            break;
            default:
                //it should never happen
                rJsonWriter.put("type", "no type?");
        }
    }
}

/// Implements getCommandValues(".uno:ExtractDocumentStructures") for charts
void GetDocStructureCharts(tools::JsonWriter& rJsonWriter, const SwDocShell* pDocShell)
{
    uno::Reference<container::XIndexAccess> xEmbeddeds(
        pDocShell->GetBaseModel()->getEmbeddedObjects(), uno::UNO_QUERY);
    if (!xEmbeddeds)
        return;

    sal_Int32 nEOcount = xEmbeddeds->getCount();

    for (int i = 0; i < nEOcount; ++i)
    {
        uno::Reference<beans::XPropertySet> xShapeProps(xEmbeddeds->getByIndex(i), uno::UNO_QUERY);
        if (!xShapeProps.is())
            continue;

        uno::Reference<frame::XModel> xDocModel;
        xShapeProps->getPropertyValue(u"Model"_ustr) >>= xDocModel;
        if (!xDocModel.is())
            continue;

        uno::Reference<chart2::XChartDocument> xChartDoc(xDocModel, uno::UNO_QUERY);
        if (!xChartDoc.is())
            continue;

        uno::Reference<chart2::data::XDataProvider> xDataProvider(xChartDoc->getDataProvider());
        if (!xDataProvider.is())
            continue;

        uno::Reference<chart::XChartDataArray> xDataArray(xChartDoc->getDataProvider(),
                                                          uno::UNO_QUERY);
        if (!xDataArray.is())
            continue;

        uno::Reference<chart2::XDiagram> xDiagram = xChartDoc->getFirstDiagram();
        if (!xDiagram.is())
            continue;

        //we have the chart Data now, we can start to extract it
        OString aNodeName("Charts.ByEmbedIndex."_ostr + OString::number(i));
        auto aChartNode = rJsonWriter.startNode(aNodeName);

        //get the object name
        uno::Reference<container::XNamed> xNamedShape(xEmbeddeds->getByIndex(i), uno::UNO_QUERY);
        if (xNamedShape.is())
        {
            OUString aName;
            aName = xNamedShape->getName();
            rJsonWriter.put("name", aName);
        }

        //get the chart title, if there is one
        uno::Reference<chart2::XTitled> xTitled(xChartDoc, uno::UNO_QUERY_THROW);
        if (xTitled.is())
        {
            uno::Reference<chart2::XTitle> xTitle = xTitled->getTitleObject();
            if (xTitle.is())
            {
                OUStringBuffer aTitle;
                const cpo::uno::Sequence<uno::Reference<chart2::XFormattedString>> aFSSeq
                    = xTitle->getText();
                for (auto const& fs : aFSSeq)
                    aTitle.append(fs->getString());
                rJsonWriter.put("title", aTitle.toString());
            }
        }

        //get the chart subtitle, if there is one
        uno::Reference<chart2::XTitled> xSubTitled(xDiagram, uno::UNO_QUERY_THROW);
        if (xSubTitled.is())
        {
            uno::Reference<chart2::XTitle> xSubTitle = xSubTitled->getTitleObject();
            if (xSubTitle.is())
            {
                OUStringBuffer aSubTitle;
                const cpo::uno::Sequence<uno::Reference<chart2::XFormattedString>> aFSSeq
                    = xSubTitle->getText();
                for (auto const& fs : aFSSeq)
                    aSubTitle.append(fs->getString());
                rJsonWriter.put("subtitle", aSubTitle.makeStringAndClear());
            }
        }

        {
            cpo::uno::Sequence<OUString> aRowDesc = xDataArray->getRowDescriptions();
            auto aRowDescNode = rJsonWriter.startArray("RowDescriptions");
            for (int j = 0; j < aRowDesc.getLength(); j++)
            {
                rJsonWriter.putSimpleValue(aRowDesc[j]);
            }
        }
        {
            cpo::uno::Sequence<OUString> aColDesc = xDataArray->getColumnDescriptions();
            auto aColDescNode = rJsonWriter.startArray("ColumnDescriptions");
            for (int j = 0; j < aColDesc.getLength(); j++)
            {
                rJsonWriter.putSimpleValue(aColDesc[j]);
            }
        }
        {
            cpo::uno::Sequence<cpo::uno::Sequence<double>> aData = xDataArray->getData();
            auto aDataValuesNode = rJsonWriter.startArray("DataValues");
            for (int j = 0; j < aData.getLength(); j++)
            {
                auto aRowNode = rJsonWriter.startAnonArray();
                for (int k = 0; k < aData[j].getLength(); k++)
                {
                    rJsonWriter.putSimpleValue(OUString::number(aData[j][k]));
                }
            }
        }
    }
}

/// Implements getCommandValues(".uno:ExtractDocumentStructures") for document properties
void GetDocStructureDocProps(tools::JsonWriter& rJsonWriter, const SwDocShell* pDocShell)
{
    uno::Reference<document::XDocumentProperties2> xDocProps(
        pDocShell->GetBaseModel()->getDocumentProperties(), uno::UNO_QUERY);
    if (!xDocProps.is())
        return;

    auto aDocPropsNode = rJsonWriter.startNode("DocumentProperties");

    // StringBuffer for converting DateTimes to String
    OUStringBuffer aDateBuf(32);

    //Properties from XDocumentProperties
    OUString aAuthor = xDocProps->getAuthor();
    rJsonWriter.put("Author", aAuthor);

    OUString aGenerator = xDocProps->getGenerator();
    rJsonWriter.put("Generator", aGenerator);

    util::DateTime aCreationDate = xDocProps->getCreationDate();
    sax::Converter::convertDateTime(aDateBuf, aCreationDate, nullptr, true);
    rJsonWriter.put("CreationDate", aDateBuf.makeStringAndClear());

    OUString aTitle = xDocProps->getTitle();
    rJsonWriter.put("Title", aTitle);

    OUString aSubject = xDocProps->getSubject();
    rJsonWriter.put("Subject", aSubject);

    OUString aDescription = xDocProps->getDescription();
    rJsonWriter.put("Description", aDescription);

    cpo::uno::Sequence<OUString> aKeywords = xDocProps->getKeywords();
    {
        auto aKeywordsNode = rJsonWriter.startArray("Keywords");
        for (int i = 0; i < aKeywords.getLength(); i++)
        {
            rJsonWriter.putSimpleValue(aKeywords[i]);
        }
    }

    lang::Locale aLanguage = xDocProps->getLanguage();
    OUString aLanguageStr(LanguageTag::convertToBcp47(aLanguage, false));
    rJsonWriter.put("Language", aLanguageStr);

    OUString aModifiedBy = xDocProps->getModifiedBy();
    rJsonWriter.put("ModifiedBy", aModifiedBy);

    util::DateTime aModificationDate = xDocProps->getModificationDate();
    sax::Converter::convertDateTime(aDateBuf, aModificationDate, nullptr, true);
    rJsonWriter.put("ModificationDate", aDateBuf.makeStringAndClear());

    OUString aPrintedBy = xDocProps->getPrintedBy();
    rJsonWriter.put("PrintedBy", aPrintedBy);

    util::DateTime aPrintDate = xDocProps->getPrintDate();
    sax::Converter::convertDateTime(aDateBuf, aPrintDate, nullptr, true);
    rJsonWriter.put("PrintDate", aDateBuf.makeStringAndClear());

    OUString aTemplateName = xDocProps->getTemplateName();
    rJsonWriter.put("TemplateName", aTemplateName);

    OUString aTemplateURL = xDocProps->getTemplateURL();
    rJsonWriter.put("TemplateURL", aTemplateURL);

    util::DateTime aTemplateDate = xDocProps->getTemplateDate();
    sax::Converter::convertDateTime(aDateBuf, aTemplateDate, nullptr, true);
    rJsonWriter.put("TemplateDate", aDateBuf.makeStringAndClear());

    OUString aAutoloadURL = xDocProps->getAutoloadURL();
    rJsonWriter.put("AutoloadURL", aAutoloadURL);

    sal_Int32 aAutoloadSecs = xDocProps->getAutoloadSecs();
    rJsonWriter.put("AutoloadSecs", aAutoloadSecs);

    OUString aDefaultTarget = xDocProps->getDefaultTarget();
    rJsonWriter.put("DefaultTarget", aDefaultTarget);

    cpo::uno::Sequence<beans::NamedValue> aDocumentStatistics = xDocProps->getDocumentStatistics();
    {
        auto aDocumentStatisticsNode = rJsonWriter.startNode("DocumentStatistics");
        for (int i = 0; i < aDocumentStatistics.getLength(); i++)
        {
            // Todo check: do all stats are integer numbers?
            sal_Int32 nValue = 0;
            aDocumentStatistics[i].Value >>= nValue;
            std::string aStr(OUStringToOString(aDocumentStatistics[i].Name, RTL_TEXTENCODING_UTF8));
            rJsonWriter.put(aStr, nValue);
        }
    }

    sal_Int16 aEditingCycles = xDocProps->getEditingCycles();
    rJsonWriter.put("EditingCycles", aEditingCycles);

    sal_Int32 aEditingDuration = xDocProps->getEditingDuration();
    rJsonWriter.put("EditingDuration", aEditingDuration);

    //Properties from XDocumentProperties2
    cpo::uno::Sequence<OUString> aContributor = xDocProps->getContributor();
    {
        auto aContributorNode = rJsonWriter.startArray("Contributor");
        for (int i = 0; i < aContributor.getLength(); i++)
        {
            rJsonWriter.putSimpleValue(aContributor[i]);
        }
    }

    OUString aCoverage = xDocProps->getCoverage();
    rJsonWriter.put("Coverage", aCoverage);

    OUString aIdentifier = xDocProps->getIdentifier();
    rJsonWriter.put("Identifier", aIdentifier);

    cpo::uno::Sequence<OUString> aPublisher = xDocProps->getPublisher();
    {
        auto aPublisherNode = rJsonWriter.startArray("Publisher");
        for (int i = 0; i < aPublisher.getLength(); i++)
        {
            rJsonWriter.putSimpleValue(aPublisher[i]);
        }
    }

    cpo::uno::Sequence<OUString> aRelation = xDocProps->getRelation();
    {
        auto aRelationNode = rJsonWriter.startArray("Relation");
        for (int i = 0; i < aRelation.getLength(); i++)
        {
            rJsonWriter.putSimpleValue(aRelation[i]);
        }
    }

    OUString aRights = xDocProps->getRights();
    rJsonWriter.put("Rights", aRights);

    OUString aSource = xDocProps->getSource();
    rJsonWriter.put("Source", aSource);

    OUString aType = xDocProps->getType();
    rJsonWriter.put("Type", aType);

    // PropertySet -> JSON
    css::uno::Reference<css::beans::XPropertyContainer> aUserDefinedProperties
        = xDocProps->getUserDefinedProperties();
    uno::Reference<beans::XPropertySet> aUserDefinedPropertySet(aUserDefinedProperties,
                                                                uno::UNO_QUERY);
    if (aUserDefinedPropertySet.is())
    {
        auto aRelationNode = rJsonWriter.startNode("UserDefinedProperties");
        const cpo::uno::Sequence<beans::Property> aProperties
            = aUserDefinedPropertySet->getPropertySetInfo()->getProperties();
        for (const beans::Property& rProperty : aProperties)
        {
            const OUString& rKey = rProperty.Name;
            auto aNode = rJsonWriter.startNode(OUStringToOString(rKey, RTL_TEXTENCODING_UTF8));
            cpo::uno::Any aValue = aUserDefinedPropertySet->getPropertyValue(rKey);

            OUString aAnyType = aValue.getValueTypeName();
            rJsonWriter.put("type", aAnyType);

            if (aAnyType == "boolean")
                rJsonWriter.put("value", aValue.get<bool>());
            else if (aAnyType == "double")
                rJsonWriter.put("value", aValue.get<double>());
            else if (aAnyType == "float")
                rJsonWriter.put("value", aValue.get<float>());
            else if (aAnyType == "long")
                rJsonWriter.put("value", aValue.get<sal_Int32>());
            else if (aAnyType == "short")
                rJsonWriter.put("value", aValue.get<sal_Int16>());
            else if (aValue.has<OUString>())
                rJsonWriter.put("value", aValue.get<OUString>());
            else if (aValue.has<sal_uInt64>())
                rJsonWriter.put("value", aValue.get<sal_Int64>());
            else
            {
                // Todo: some more types should be supported..
                // AddProperty allow these 13 types:
                // "com.sun.star.util.Date", "DateTime", "DateTimeWithTimezone",
                // "DateWithTimezone", "Duration", "Time"
                // typelib_TypeClass_BOOLEAN, typelib_TypeClass_DOUBLE, typelib_TypeClass_FLOAT
                // typelib_TypeClass_HYPER, typelib_TypeClass_LONG, typelib_TypeClass_SHORT,
                // typelib_TypeClass_STRING
            }
        }
    }
}

// The textBefore / textAfter of a redline show the text around it as it was when that redline was
// made: every Insert / Delete redline as old as it or older reads as accepted, and every newer one
// as rejected. The read used to put the document itself into that state - hiding and showing those
// redlines with SwRangeRedline::Show / Hide / ShowOriginal, i.e. MoveToSection / MoveFromSection -
// and restore it afterwards. That round trip is not exactly reversible: it moved redline
// boundaries, rewrote formatting inside deletions and could leave a layout that ran away, and every
// live agent edit reads the redlines first, so the user's open document changed silently and
// autosave kept it. The text is now read from the document as it is, skipping the
// redlines that were missing at that time, and nothing in the document changes.

// Whether rRedline's text was missing at rLimit, in the states the old hide / show put it in: an
// accepted deletion (as old as the limit or older) is gone, and a rejected insertion (newer) is not
// there yet - unless the oldest change in its stack is not an insertion, whose text rejecting it
// leaves. No other redline type changes the text.
bool IsAbsentAt(const SwRangeRedline& rRedline, const DateTime& rLimit)
{
    const SwRedlineData& rData = rRedline.GetRedlineData();
    const bool bNewer = rLimit < rData.GetTimeStamp();
    switch (rData.GetType())
    {
        case RedlineType::Delete:
            return !bNewer;
        case RedlineType::Insert:
            return bNewer
                   && rRedline.GetType(rRedline.GetStackCount() - 1) == RedlineType::Insert;
        default:
            return false;
    }
}

// The start node of the text a cursor at rNode stays in, as SwUnoCursor::IsSelOvr keeps it: the
// body, a table cell, a footnote, a header or footer, or a frame. Sections don't bound it.
const SwStartNode& GetTextAreaStart(const SwNode& rNode)
{
    const SwStartNode* pStart = rNode.StartOfSectionNode();
    while (pStart->IsSectionNode())
        pStart = pStart->StartOfSectionNode();
    return *pStart;
}

// Moves rPos to the end of the closest content node before its own, but not before node nFirst.
bool GoToPrevContentEnd(SwPosition& rPos, SwNodeOffset nFirst)
{
    const SwNodes& rNodes = rPos.GetNodes();
    for (SwNodeOffset n = rPos.GetNodeIndex() - 1; n >= nFirst; --n)
    {
        if (SwContentNode* pNode = rNodes[n]->GetContentNode())
        {
            rPos.AssignEndIndex(*pNode);
            return true;
        }
    }
    return false;
}

// Moves rPos to the start of the closest content node after its own, but not after node nLast.
bool GoToNextContentStart(SwPosition& rPos, SwNodeOffset nLast)
{
    const SwNodes& rNodes = rPos.GetNodes();
    for (SwNodeOffset n = rPos.GetNodeIndex() + 1; n <= nLast; ++n)
    {
        if (SwContentNode* pNode = rNodes[n]->GetContentNode())
        {
            rPos.AssignStartIndex(*pNode);
            return true;
        }
    }
    return false;
}

// The text of [rStart, rEnd] as XTextRange::getString reads it.
OUString GetRangeText(const SwPosition& rStart, const SwPosition& rEnd)
{
    OUString aText;
    if (rStart < rEnd)
    {
        SwPaM aPam(rStart, rEnd);
        SwUnoCursorHelper::GetTextFromPam(aPam, aText);
    }
    return aText;
}

// The Insert / Delete redlines of a table, in its order: the only ones whose text can be missing at
// a time (IsAbsentAt). They never overlap each other, so they are sorted by end as well as by start.
// A paragraph-attribute redline can overlap them - one made on a paragraph later deleted lies inside
// that deletion - which is why the walks below look only at these.
using TextRedlines = std::vector<const SwRangeRedline*>;

TextRedlines GetTextRedlines(const SwRedlineTable& rTable)
{
    TextRedlines aRedlines;
    for (const SwRangeRedline* pRedline : rTable)
    {
        const RedlineType eType = pRedline->GetRedlineData().GetType();
        if (eType == RedlineType::Insert || eType == RedlineType::Delete)
            aRedlines.push_back(pRedline);
    }
    return aRedlines;
}

// Reads up to nSteps steps of text back from rFrom as the text was at rLimit. A step is a code
// point, or the boundary between two paragraphs, as XTextCursor::goLeft moves; the walk stays in the
// body, cell, footnote, header, footer or frame that holds rFrom. A redline missing at rLimit
// (IsAbsentAt) is skipped whole: neither its characters nor a paragraph boundary inside it takes a
// step or reads as anything, as if it had been removed and the paragraphs around it joined. Each
// redline the walk reaches is looked at once, so a read costs O(nSteps + log n) plus the redlines it
// passes, not O(table).
OUString ReadTextBefore(const TextRedlines& rRedlines, const SwPosition& rFrom,
                        const DateTime& rLimit, sal_uInt16 nSteps)
{
    const SwNodeOffset nFirst = GetTextAreaStart(rFrom.GetNode()).GetIndex() + 1;
    SwPosition aPos(rFrom);
    std::vector<std::pair<SwPosition, SwPosition>> aSkipped; // missing stretches, last one first
    // The walk reaches rRedlines[nNext - 1] next: the last one that starts before rFrom.
    size_t nNext = std::partition_point(rRedlines.begin(), rRedlines.end(),
                                        [&rFrom](const SwRangeRedline* p)
                                        { return *p->Start() < rFrom; })
                   - rRedlines.begin();
    for (sal_uInt16 nLeft = nSteps; nLeft;)
    {
        // One that ends at or after aPos has been reached: skip it whole if it was missing then,
        // read through it otherwise.
        if (nNext > 0 && !(*rRedlines[nNext - 1]->End() < aPos))
        {
            const SwRangeRedline& rRedline = *rRedlines[--nNext];
            if (*rRedline.Start() < aPos && IsAbsentAt(rRedline, rLimit))
            {
                const SwPosition aSkipEnd(aPos);
                aPos = *rRedline.Start();
                // It may start on a table or section node: read on from the text before that.
                const bool bInText
                    = aPos.GetNodeIndex() >= nFirst
                      && (aPos.GetNode().IsContentNode() || GoToPrevContentEnd(aPos, nFirst));
                aSkipped.emplace_back(aPos, aSkipEnd);
                if (!bInText)
                    break;
            }
            continue;
        }
        // Step back through the paragraph, as far as the end of the next redline if it is in it.
        const sal_Int32 nIndex = aPos.GetContentIndex();
        sal_Int32 nStop = 0;
        if (nNext > 0 && rRedlines[nNext - 1]->End()->GetNodeIndex() == aPos.GetNodeIndex())
            nStop = rRedlines[nNext - 1]->End()->GetContentIndex();
        const SwTextNode* pTextNode = aPos.GetNode().GetTextNode();
        if (pTextNode && nIndex > nStop)
        {
            const OUString& rText = pTextNode->GetText();
            sal_Int32 nNewIndex = nIndex;
            while (nLeft && nNewIndex > nStop)
            {
                rText.iterateCodePoints(&nNewIndex, -1);
                --nLeft;
            }
            aPos.SetContent(std::max(nNewIndex, nStop));
        }
        // At the start of the paragraph: the boundary with the one before is a step.
        else if (GoToPrevContentEnd(aPos, nFirst))
            --nLeft;
        else
            break; // the start of the text
    }

    OUStringBuffer aText;
    SwPosition aPieceStart(aPos);
    for (auto it = aSkipped.rbegin(); it != aSkipped.rend(); ++it)
    {
        aText.append(GetRangeText(aPieceStart, it->first));
        aPieceStart = it->second;
    }
    aText.append(GetRangeText(aPieceStart, rFrom));
    return aText.makeStringAndClear();
}

// Reads up to nSteps steps of text on from rFrom as the text was at rLimit; the forward counterpart
// of ReadTextBefore, as XTextCursor::goRight moves.
OUString ReadTextAfter(const TextRedlines& rRedlines, const SwPosition& rFrom,
                       const DateTime& rLimit, sal_uInt16 nSteps)
{
    const SwNodeOffset nLast = GetTextAreaStart(rFrom.GetNode()).EndOfSectionIndex() - 1;
    SwPosition aPos(rFrom);
    std::vector<std::pair<SwPosition, SwPosition>> aSkipped; // missing stretches, first one first
    // The walk reaches rRedlines[nNext] next: the first one that ends after rFrom.
    size_t nNext = std::partition_point(rRedlines.begin(), rRedlines.end(),
                                        [&rFrom](const SwRangeRedline* p)
                                        { return !(rFrom < *p->End()); })
                   - rRedlines.begin();
    for (sal_uInt16 nLeft = nSteps; nLeft;)
    {
        // One that starts at or before aPos has been reached: skip it whole if it was missing
        // then, read through it otherwise.
        if (nNext < rRedlines.size() && !(aPos < *rRedlines[nNext]->Start()))
        {
            const SwRangeRedline& rRedline = *rRedlines[nNext++];
            if (aPos < *rRedline.End() && IsAbsentAt(rRedline, rLimit))
            {
                const SwPosition aSkipStart(aPos);
                aPos = *rRedline.End();
                // It may end on a table or section node: read on from the text after that.
                const bool bInText
                    = aPos.GetNodeIndex() <= nLast
                      && (aPos.GetNode().IsContentNode() || GoToNextContentStart(aPos, nLast));
                aSkipped.emplace_back(aSkipStart, aPos);
                if (!bInText)
                    break;
            }
            continue;
        }
        // Step on through the paragraph, as far as the start of the next redline if it is in it.
        const sal_Int32 nIndex = aPos.GetContentIndex();
        sal_Int32 nStop = aPos.GetNode().GetContentNode()->Len();
        if (nNext < rRedlines.size()
            && rRedlines[nNext]->Start()->GetNodeIndex() == aPos.GetNodeIndex())
            nStop = rRedlines[nNext]->Start()->GetContentIndex();
        const SwTextNode* pTextNode = aPos.GetNode().GetTextNode();
        if (pTextNode && nIndex < nStop)
        {
            const OUString& rText = pTextNode->GetText();
            sal_Int32 nNewIndex = nIndex;
            while (nLeft && nNewIndex < nStop)
            {
                rText.iterateCodePoints(&nNewIndex, 1);
                --nLeft;
            }
            aPos.SetContent(std::min(nNewIndex, nStop));
        }
        // At the end of the paragraph: the boundary with the next one is a step.
        else if (GoToNextContentStart(aPos, nLast))
            --nLeft;
        else
            break; // the end of the text
    }

    OUStringBuffer aText;
    SwPosition aPieceStart(rFrom);
    for (const auto& [rSkipStart, rSkipEnd] : aSkipped)
    {
        aText.append(GetRangeText(aPieceStart, rSkipStart));
        aPieceStart = rSkipEnd;
    }
    aText.append(GetRangeText(aPieceStart, aPos));
    return aText.makeStringAndClear();
}

// The text of [rStart, rEnd], the range of rRedline, as it was at rLimit: the parts of the other
// redlines missing then are left out. Only a paragraph-attribute redline has others inside it; any
// other range reads whole.
OUString ReadChangedText(const TextRedlines& rRedlines, const SwRangeRedline& rRedline,
                         const SwPosition& rStart, const SwPosition& rEnd, const DateTime& rLimit)
{
    OUStringBuffer aText;
    SwPosition aPieceStart(rStart);
    // From the first one that ends after rStart, as long as they start before rEnd
    for (auto it = std::partition_point(rRedlines.begin(), rRedlines.end(),
                                        [&rStart](const SwRangeRedline* p)
                                        { return !(rStart < *p->End()); });
         it != rRedlines.end() && *(*it)->Start() < rEnd; ++it)
    {
        const SwRangeRedline& rOther = **it;
        if (&rOther == &rRedline || !IsAbsentAt(rOther, rLimit))
            continue;
        aText.append(GetRangeText(aPieceStart, *rOther.Start()));
        const SwPosition& rSkipEnd = std::min(*rOther.End(), rEnd);
        if (aPieceStart < rSkipEnd)
            aPieceStart = rSkipEnd;
    }
    aText.append(GetRangeText(aPieceStart, rEnd));
    return aText.makeStringAndClear();
}

// Holds every view of the document inside one layout action. Each piece of text below is read
// through SwWriter, which starts and ends an action of its own, and ending the outermost one runs a
// layout pass; nested, those inner actions only count.
class AllViewsActionGuard
{
public:
    explicit AllViewsActionGuard(SwEditShell* pShell)
        : m_pShell(pShell)
    {
        if (m_pShell)
            m_pShell->StartAllAction();
    }
    ~AllViewsActionGuard()
    {
        if (m_pShell)
            suppress_fun_call_w_exception(m_pShell->EndAllAction());
    }
    AllViewsActionGuard(const AllViewsActionGuard&) = delete;
    AllViewsActionGuard& operator=(const AllViewsActionGuard&) = delete;

private:
    SwEditShell* m_pShell;
};

/// Implements getCommandValues(".uno:ExtractDocumentStructures") for redlines
void GetDocStructureTrackChanges(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell,
                                 std::u16string_view filterArguments)
{
    // filter arguments are separated from the filter name by comma, and are name:value pairs
    // separated by commas
    if (!filterArguments.empty() && !filterArguments.starts_with(u","))
        return; // not a correct filter
    sal_Int16 nContextLen = 200;
    bool bPageNumbers = false;
    for (size_t paramPos = 1; paramPos < filterArguments.size();)
    {
        std::u16string_view param = o3tl::getToken(filterArguments, u',', paramPos);
        sal_Int32 nIndex = 0;
        std::u16string_view token = o3tl::trim(o3tl::getToken(param, 0, u':', nIndex));
        std::u16string_view value
            = nIndex > 0 ? o3tl::trim(param.substr(nIndex)) : std::u16string_view{};
        if (token == u"contextLen")
        {
            // The walk counts steps unsigned, so a negative length would read 65535 of them where
            // goLeft / goRight took none. 500 is the most any caller asks for
            // (VulcanWriterBridge.fetchRedlines).
            if (!value.empty())
                nContextLen = std::clamp<sal_Int32>(o3tl::toInt32(value), 0, 500);
        }
        else if (token == u"startPageNumber")
        {
            bPageNumbers = value == u"true";
        }
        // else unknown filter argument (maybe from a newer API?) - ignore
    }

    SwDoc& rDoc = *pDocShell->GetDoc();
    const SwRedlineTable& rTable = rDoc.getIDocumentRedlineAccess().GetRedlineTable();
    // The step count XTextCursor::goLeft / goRight took it as.
    const sal_uInt16 nContextSteps = static_cast<sal_uInt16>(nContextLen);
    // Read from the layout the views show, without moving any view's cursor to the change.
    const bool bWithPageNumbers
        = bPageNumbers && rDoc.getIDocumentLayoutAccess().GetCurrentLayout();

    const TextRedlines aTextRedlines = GetTextRedlines(rTable);
    AllViewsActionGuard aLayoutAction(rDoc.GetEditShell());
    for (size_t i = 0; i < rTable.size(); ++i)
    {
        SwRangeRedline& rRedline = *rTable[i];
        rtl::Reference<SwXRedline> pSwXRedline(new SwXRedline(rRedline));

        auto TrackChangesNode
            = rJsonWriter.startNode(Concat2View("TrackChanges.ByIndex." + OString::number(i)));

        // Vulcan: the stable, accept/reject-addressable redline id
        // (.uno:AcceptTrackedChange resolves its arg against GetId()). The
        // agent bridge reads ids from THIS filter because the
        // .uno:AcceptTrackedChanges commandvalues serializer is dead under
        // coolwsd's default DISABLE_REDLINE (redlining_as_comments=false).
        rJsonWriter.put("id", rRedline.GetId());

        PropertyExtractor extractor{ pSwXRedline, rJsonWriter };

        extractor.extract<OUString>(UNO_NAME_REDLINE_TYPE, "type");
        extractor.extract<css::util::DateTime>(UNO_NAME_REDLINE_DATE_TIME, "dateTime");
        extractor.extract<OUString>(UNO_NAME_REDLINE_AUTHOR, "author");
        extractor.extract<OUString>(UNO_NAME_REDLINE_DESCRIPTION, "description");
        extractor.extract<OUString>(UNO_NAME_REDLINE_COMMENT, "comment");

        // A redline can start or end on a table or section node (UNO_NAME_REDLINE_START / END give
        // no text range there), which has no text around it.
        const SwPosition& rStart = *rRedline.Start();
        const SwPosition& rEnd = *rRedline.End();
        const bool bStartInText = rStart.GetNode().IsTextNode();
        const bool bEndInText = rEnd.GetNode().IsTextNode();
        if (bStartInText)
        {
            if (bWithPageNumbers)
            {
                SwPaM aStart(rStart);
                rJsonWriter.put("startPageNumber", static_cast<sal_Int16>(aStart.GetPageNum()));
            }
            rJsonWriter.put("textBefore", ReadTextBefore(aTextRedlines, rStart,
                                                         rRedline.GetTimeStamp(), nContextSteps));
        }
        if (bEndInText)
            rJsonWriter.put("textAfter", ReadTextAfter(aTextRedlines, rEnd, rRedline.GetTimeStamp(),
                                                       nContextSteps));
        // The added / deleted / formatted text, as it was when the change was made
        OUString changeText;
        if (bStartInText && bEndInText)
            changeText = ReadChangedText(aTextRedlines, rRedline, rStart, rEnd,
                                         rRedline.GetTimeStamp());
        if (changeText.isEmpty())
        {
            // A redline whose text a view hides in a section of its own reads it from there
            if (auto xRedlineText = pSwXRedline->getPropertyValue(UNO_NAME_REDLINE_TEXT)
                                        .query<css::text::XText>())
                changeText = xRedlineText->getString();
        }
        rJsonWriter.put("textChanged", changeText); // write unconditionally
        // UNO_NAME_REDLINE_IDENTIFIER: OUString (the value of a pointer, not persistent)
        // UNO_NAME_REDLINE_MOVED_ID: sal_uInt32; 0 == not moved, 1 == moved, but don't have its pair, 2+ == unique ID
        // UNO_NAME_REDLINE_SUCCESSOR_DATA: cpo::uno::Sequence<beans::PropertyValue>
        // UNO_NAME_IS_IN_HEADER_FOOTER: bool
        // UNO_NAME_MERGE_LAST_PARA: bool
    }
}

/// Resolves a heading subtree to a node range: the heading whose canonical
/// link-target name matches rName, plus every following node up to the next
/// heading of the same or a higher outline level (mirrors
/// SwCursorShell::MakeOutlineSel with children). The canonical name is built
/// by SwGetOutlineLinkName - the same string the XLinkTargetSupplier emits
/// through extract_link_targets - so a target identifier the model received
/// round-trips exactly, including chapter numbering and layout-rendered prefix
/// or trailing fields.
bool FindOutlineScope(SwDoc& rDoc, std::u16string_view rName, SwNodeOffset& rStart,
                      SwNodeOffset& rEnd)
{
    const SwOutlineNodes& rOutlNds = rDoc.GetNodes().GetOutLineNds();
    for (SwOutlineNodes::size_type i = 0; i < rOutlNds.size(); ++i)
    {
        if (SwGetOutlineLinkName(i, &rDoc) != rName)
            continue;

        const SwTextNode* pTextNd = rOutlNds[i]->GetTextNode();
        if (!pTextNd)
            continue;

        rStart = rOutlNds[i]->GetIndex();
        const int nLevel = pTextNd->GetAttrOutlineLevel() - 1;
        SwOutlineNodes::size_type nEnd = i + 1;
        for (; nEnd < rOutlNds.size(); ++nEnd)
        {
            const SwTextNode* pNext = rOutlNds[nEnd]->GetTextNode();
            if (pNext && pNext->GetAttrOutlineLevel() - 1 <= nLevel)
                break;
        }
        rEnd = (nEnd < rOutlNds.size()) ? rOutlNds[nEnd]->GetIndex()
                                        : rDoc.GetNodes().GetEndOfContent().GetIndex();
        return true;
    }
    return false;
}

/// Resolves a named text section to its node range.
bool FindSectionScope(SwDoc& rDoc, std::u16string_view rName, SwNodeOffset& rStart,
                      SwNodeOffset& rEnd)
{
    for (const SwSectionFormat* pFormat : rDoc.GetSections())
    {
        const SwSection* pSect = pFormat->GetSection();
        if (!pSect || pSect->GetSectionName().toString() != rName)
            continue;
        const SwSectionNode* pSectNd = pFormat->GetSectionNode();
        if (!pSectNd)
            return false;
        rStart = pSectNd->GetIndex();
        rEnd = pSectNd->EndOfSectionIndex();
        return true;
    }
    return false;
}

/// Walks the XLinkTargetSupplier name access and writes the same nested
/// category JSON shape that the disk-reload path produces in init.cxx's
/// extractLinks, so the model sees an identical structure whether the call
/// runs against a live document or a hidden read-only reload. Returns the number of
/// leaf entries written, which lets callers distinguish a document that has
/// navigation targets from one that has none.
sal_Int32 WriteLinkTargets(const uno::Reference<container::XNameAccess>& xLinks, bool bSubcontent,
                           tools::JsonWriter& rJsonWriter)
{
    if (!xLinks.is())
        return 0;
    sal_Int32 nLeaves = 0;
    for (const OUString& aLink : xLinks->getElementNames())
    {
        cpo::uno::Any aAny;
        try
        {
            aAny = xLinks->getByName(aLink);
        }
        catch (const uno::Exception&)
        {
            continue;
        }
        uno::Reference<beans::XPropertySet> xTarget;
        if (!(aAny >>= xTarget))
            continue;
        try
        {
            OUString aDisplayName;
            xTarget->getPropertyValue(u"LinkDisplayName"_ustr) >>= aDisplayName;
            if (bSubcontent)
            {
                // The live document expands Table of Contents paragraphs as
                // outline nodes whose rendered text carries the ToC layout's
                // tab separators ("N \tHeading\tPage"). These duplicate the
                // real headings the model already has and confuse the picker,
                // so skip them. Disk-reload extractRequest never saw these
                // because the hidden read-only load does not expand the ToC.
                // Genuine headings never contain a tab in their node text.
                if (aLink.indexOf(u'\t') >= 0)
                    continue;
                rJsonWriter.put(aDisplayName, aLink);
                ++nLeaves;
                continue;
            }
            uno::Reference<lang::XServiceInfo> xSI(xTarget, uno::UNO_QUERY_THROW);
            if (xSI->supportsService(u"com.sun.star.document.LinkTarget"_ustr))
            {
                rJsonWriter.put(aDisplayName, aLink);
                ++nLeaves;
                continue;
            }
            auto aNode
                = rJsonWriter.startNode(OUStringToOString(aDisplayName, RTL_TEXTENCODING_UTF8));
            uno::Reference<document::XLinkTargetSupplier> xLTS(xTarget, uno::UNO_QUERY);
            if (xLTS.is())
                nLeaves += WriteLinkTargets(xLTS->getLinks(), /*subcontent*/ true, rJsonWriter);
        }
        catch (...)
        {
            // a target with a missing display name or service info is skipped
        }
    }
    return nLeaves;
}

/// Implements getCommandValues(".uno:ExtractDocumentStructure?filter=text").
///
/// Exports the document body as markdown so the AI assistant can summarize or
/// answer questions about it. Reads the live document (the caller routes
/// filter=text to the in-memory doc, not the on-disk reload), so unsaved edits
/// are reflected. The result is capped and flags truncation.
///
/// When rTarget is set it names a single slice to read instead of the whole
/// body. It is one of the values from extract_link_targets, in the form
/// "name|type": type "outline" reads that heading's section, "region" reads a
/// named text section. This lets a follow-up read one slice rather than the
/// whole body.
void GetDocStructureBodyText(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell,
                             std::u16string_view rTarget)
{
    auto aNode = rJsonWriter.startNode("BodyText");
    rJsonWriter.put("format", "markdown");

    SwDoc* pDoc = pDocShell ? pDocShell->GetDoc() : nullptr;
    WriterRef xWrt;
    // NoImages: the AI text-extraction path discards image markup
    // anyway, and inline base64 graphics would otherwise blow past the
    // text budget on documents with embedded pictures.
    if (pDoc)
        GetMDWriter(u"NoImages", OUString(), xWrt);
    if (!pDoc || !xWrt.is())
    {
        rJsonWriter.put("text", "");
        rJsonWriter.put("truncated", false);
        return;
    }

    xWrt->SetShowProgress(false);

    // Resolve an optional scope so only one slice is exported.
    std::shared_ptr<SwUnoCursor> pScopePam;
    if (!rTarget.empty())
    {
        const size_t nSep = rTarget.rfind(u'|');
        const std::u16string_view aName
            = (nSep == std::u16string_view::npos) ? rTarget : rTarget.substr(0, nSep);
        const std::u16string_view aType = (nSep == std::u16string_view::npos)
                                              ? std::u16string_view()
                                              : rTarget.substr(nSep + 1);

        SwNodeOffset nStart(0), nEnd(0);
        const bool bFound = (aType == u"region") ? FindSectionScope(*pDoc, aName, nStart, nEnd)
                                                 : FindOutlineScope(*pDoc, aName, nStart, nEnd);
        if (!bFound)
        {
            rJsonWriter.put("truncated", false);
            rJsonWriter.put("error",
                            "Target not found in the document. Call extract_link_targets to list "
                            "valid targets, or omit target to read the whole body.");
            rJsonWriter.put("text", "");
            return;
        }
        pScopePam = Writer::NewUnoCursor(*pDoc, nStart, nEnd);
    }

    SvMemoryStream aStream;
    OUString aText;
    bool bTruncated = false;
    bool bWriteOk = false;
    if (pScopePam)
    {
        SwWriter aWrt(aStream, *pScopePam, /*bWriteAll*/ false);
        bWriteOk = !aWrt.Write(xWrt).IsError();
    }
    else
    {
        // A whole-document SwWriter is a save as far as SwWriter::Write is
        // concerned: on success it calls ResetModified() and clears the
        // links-updated flag. This is a read, so an unsaved edit made before
        // it must stay unsaved-and-modified - otherwise idle/timed autosave
        // never fires and the edit is discarded when the view closes (
        // an agent replace followed by this read was silently lost). Keep the
        // undo stack's unmodified marker where it was, too.
        IDocumentState& rState = pDoc->getIDocumentState();
        IDocumentUndoRedo& rUndo = pDoc->GetIDocumentUndoRedo();
        IDocumentLinksAdministration& rLinks = pDoc->getIDocumentLinksAdministration();
        const bool bWasModified = rState.IsModified();
        const bool bLinksWereUpdated = rLinks.LinksUpdated();
        rUndo.LockUndoNoModifiedPosition();
        {
            SwWriter aWrt(aStream, *pDoc);
            bWriteOk = !aWrt.Write(xWrt).IsError();
        }
        rUndo.UnLockUndoNoModifiedPosition();
        if (bWasModified && !rState.IsModified())
            rState.SetModified();
        if (bLinksWereUpdated && !rLinks.LinksUpdated())
            rLinks.SetLinksUpdated(true);
    }
    if (bWriteOk)
    {
        const sal_uInt64 nSize = aStream.TellEnd();
        aStream.Seek(0);
        const OString aRaw = read_uInt8s_ToOString(aStream, nSize);
        aText = OStringToOUString(aRaw, RTL_TEXTENCODING_UTF8);
        if (aText.getLength() > KitHelper::AIBodyTextMaxChars)
        {
            aText = aText.copy(0, KitHelper::AIBodyTextMaxChars);
            bTruncated = true;
        }
    }

    // Emit the status and an explicit instruction before the text, so the model
    // acts on it rather than overlooking a flag buried after a large body of
    // markdown. An export failure is flagged distinctly from an empty document.
    rJsonWriter.put("truncated", bTruncated);
    if (!bWriteOk)
    {
        rJsonWriter.put("error", "Failed to export the document text.");
        rJsonWriter.put("text", aText);
        return;
    }
    // A whole-body read that would truncate gets replaced with the live link
    // target list and a direct instruction. The model has no body to summarize
    // from in this branch, so the prior approach (returning the partial body
    // with a hint to ask the user) is removed: weak models ignored the hint
    // and summarized the truncated head anyway. With no text and an explicit
    // instruction, the model must show the link_targets to the user and wait
    // for a pick.
    // Scoped reads (rTarget set) keep their current shape and still report
    // truncation through the existing flag.
    if (bTruncated && rTarget.empty())
    {
        sal_Int32 nLeaves = 0;
        {
            auto aLinkNode = rJsonWriter.startNode("link_targets");
            rtl::Reference<SwXTextDocument> xDoc = pDocShell ? pDocShell->GetBaseModel() : nullptr;
            if (xDoc.is())
                nLeaves = WriteLinkTargets(xDoc->getLinks(), /*subcontent*/ false, rJsonWriter);
        }
        rJsonWriter.put(
            "instruction",
            nLeaves > 0 ? "Document is too large to read in full. Show the user the headings and "
                          "sections from link_targets and ask which one to summarize. Do not "
                          "guess - wait for the user's choice, then call this tool again with the "
                          "selected target."
                        : "Document is too large to read in full and has no headings or named "
                          "sections to scope the read by. Ask the user to select the relevant "
                          "text in the document and resend the request; the selection will be "
                          "delivered with the next message.");
        rJsonWriter.put("text", "");
        return;
    }
    rJsonWriter.put("text", aText);
}

/// Implements getCommandValues(".uno:ExtractDocumentStructures").
///
/// Parameters:
///
/// - filter: To filter what document structure types to extract
void GetDocStructure(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell,
                     const std::map<OUString, OUString>& rArguments)
{
    auto commentsNode = rJsonWriter.startNode("DocStructure");

    OUString filter;
    if (auto it = rArguments.find(u"filter"_ustr); it != rArguments.end())
        filter = it->second;

    if (filter.isEmpty() || filter == "charts")
        GetDocStructureCharts(rJsonWriter, pDocShell);

    if (filter.isEmpty() || filter == "contentcontrol")
        GetDocStructureContentControls(rJsonWriter, pDocShell);

    if (filter.isEmpty() || filter == "docprops")
        GetDocStructureDocProps(rJsonWriter, pDocShell);

    if (std::u16string_view rest; filter.isEmpty() || filter.startsWith("trackchanges", &rest))
        GetDocStructureTrackChanges(rJsonWriter, pDocShell, o3tl::trim(rest));

    // Body text is only emitted on an explicit filter=text request, which the
    // caller routes to the live document. It is deliberately excluded from the
    // empty "extract everything" filter, which runs against the on-disk reload.
    // An optional ",target:name|type" sub-arg scopes the read to one slice.
    if (filter == "text" || filter.startsWith("text,"))
    {
        OUString target;
        if (const sal_Int32 nPos = filter.indexOf(u"target:"); nPos >= 0)
            target = filter.copy(nPos + 7);
        GetDocStructureBodyText(rJsonWriter, pDocShell, target);
    }
}

/// Implements getCommandValues(".uno:ExtractLinkTargets").
///
/// Enumerates link targets from the live document (headings, sections,
/// bookmarks, tables, frames, graphics, OLE objects, drawing objects),
/// producing the same JSON shape as the disk-reload extractRequest path in
/// init.cxx so callers can switch between the two without observing a
/// difference beyond unsaved-edit visibility. Used by the interactive
/// extractlinktargets handler in the kit and by GetDocStructureBodyText to
/// inline navigation targets when a whole-body read would overflow the
/// AIBodyTextMaxChars cap.
void GetExtractLinkTargets(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell)
{
    auto aNode = rJsonWriter.startNode("Targets");
    if (!pDocShell)
        return;
    rtl::Reference<SwXTextDocument> xDoc = pDocShell->GetBaseModel();
    if (!xDoc.is())
        return;
    WriteLinkTargets(xDoc->getLinks(), /*subcontent*/ false, rJsonWriter);
}

/// Implements getCommandValues(".uno:Sections").
///
/// Parameters:
///
/// - namePrefix: field name prefix to not return all sections
void GetSections(tools::JsonWriter& rJsonWriter, SwDocShell* pDocShell,
                 const std::map<OUString, OUString>& rArguments)
{
    OUString aNamePrefix;
    {
        auto it = rArguments.find(u"namePrefix"_ustr);
        if (it != rArguments.end())
        {
            aNamePrefix = it->second;
        }
    }

    SwDoc* pDoc = pDocShell->GetDoc();
    auto aBookmarks = rJsonWriter.startArray("sections");
    for (const auto& pSection : pDoc->GetSections())
    {
        if (!pSection->GetName().toString().startsWith(aNamePrefix))
        {
            continue;
        }

        auto aProperty = rJsonWriter.startStruct();
        rJsonWriter.put("name", pSection->GetName().toString());
    }
}
}

bool SwXTextDocument::supportsCommand(std::u16string_view rCommand)
{
    static const std::initializer_list<std::u16string_view> vForward
        = { u"TextFormFields",
            u"TextFormField",
            u"SetDocumentProperties",
            u"Bookmarks",
            u"Fields",
            u"Sections",
            u"Bookmark",
            u"Field",
            u"Layout",
            u"ContentExtent",
            u"ExtractDocumentStructure",
            u"ExtractLinkTargets" };

    return std::find(vForward.begin(), vForward.end(), rCommand) != vForward.end();
}

int SwXTextDocument::getEditMode()
{
    if (!m_pDocShell)
        return 0;

    SwViewShell* pViewShell = m_pDocShell->GetWrtShell();
    if (!pViewShell)
    {
        return 0;
    }

    SfxViewShell* pView = pViewShell->GetSfxViewShell();
    if (!pView)
    {
        return 0;
    }
    return pView->getEditMode();
}

void SwXTextDocument::setEditMode(int nEditMode)
{
    if (!m_pDocShell)
        return;

    auto eMode = static_cast<SwRedlineRenderMode>(nEditMode);
    SwViewShell* pViewShell = m_pDocShell->GetWrtShell();
    if (!pViewShell)
    {
        return;
    }

    SwViewOption aOpt(*pViewShell->GetViewOptions());
    if (eMode != aOpt.GetRedlineRenderMode())
    {
        aOpt.SetRedlineRenderMode(eMode);
        pViewShell->ApplyViewOptions(aOpt);
    }
}

OUString SwXTextDocument::getPartInfo(int /*nPart*/)
{
    tools::JsonWriter jsonWriter;
    jsonWriter.put("mode", getEditMode());
    jsonWriter.put("partHasComments", partHasComments() ? "true" : "false");
    return OUString::fromUtf8(jsonWriter.finishAndGetAsOString());
}

void SwXTextDocument::getCommandValues(tools::JsonWriter& rJsonWriter, std::string_view rCommand)
{
    using namespace std::string_view_literals;
    std::map<OUString, OUString> aMap
        = KitHelper::parseCommandParameters(OUString::fromUtf8(rCommand));

    if (o3tl::starts_with(rCommand, ".uno:TextFormFields"sv))
    {
        GetTextFormFields(rJsonWriter, m_pDocShell, aMap);
    }
    if (o3tl::starts_with(rCommand, ".uno:TextFormField"sv))
    {
        GetTextFormField(rJsonWriter, m_pDocShell, aMap);
    }
    else if (o3tl::starts_with(rCommand, ".uno:SetDocumentProperties"sv))
    {
        GetDocumentProperties(rJsonWriter, m_pDocShell, aMap);
    }
    else if (o3tl::starts_with(rCommand, ".uno:Bookmarks"sv))
    {
        GetBookmarks(rJsonWriter, m_pDocShell, aMap);
    }
    else if (o3tl::starts_with(rCommand, ".uno:Fields"sv))
    {
        GetFields(rJsonWriter, m_pDocShell, aMap);
    }
    else if (o3tl::starts_with(rCommand, ".uno:Sections"sv))
    {
        GetSections(rJsonWriter, m_pDocShell, aMap);
    }
    else if (o3tl::starts_with(rCommand, ".uno:Bookmark"sv))
    {
        GetBookmark(rJsonWriter, m_pDocShell, aMap);
    }
    else if (o3tl::starts_with(rCommand, ".uno:Field"sv))
    {
        GetField(rJsonWriter, m_pDocShell, aMap);
    }
    else if (o3tl::starts_with(rCommand, ".uno:ExtractDocumentStructure"sv))
    {
        GetDocStructure(rJsonWriter, m_pDocShell, aMap);
    }
    else if (o3tl::starts_with(rCommand, ".uno:ExtractLinkTargets"sv))
    {
        GetExtractLinkTargets(rJsonWriter, m_pDocShell);
    }
    else if (o3tl::starts_with(rCommand, ".uno:Layout"sv))
    {
        GetLayout(rJsonWriter, m_pDocShell);
    }
    else if (o3tl::starts_with(rCommand, ".uno:ContentExtent"sv))
    {
        GetContentExtent(rJsonWriter, m_pDocShell);
    }
}

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
