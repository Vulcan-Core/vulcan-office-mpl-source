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

#include <svdpdf.hxx>
#include <cmath>
#include <svx/svdpdfrawtext.hxx>
#include <svx/vulcanprovenance.hxx>
#include <comphelper/hash.hxx>
#include <vcl/BitmapPalette.hxx>
#include <vcl/BitmapWriteAccess.hxx>
#include <basegfx/numeric/ftools.hxx>
#include <limits>
#include <map>
#include <algorithm>

#include <tools/UnitConversion.hxx>
#include <vcl/canvastools.hxx>
#include <vcl/embeddedfontsmanager.hxx>
#include <vcl/graph.hxx>
#include <vcl/graphicfilter.hxx>
#include <vcl/BitmapReadAccess.hxx>
#include <vcl/vectorgraphicdata.hxx>
#include <tools/stream.hxx>
#include <rtl/ustrbuf.hxx>

#include <editeng/eeitem.hxx>
#include <svx/sdtaitm.hxx>
#include <editeng/fhgtitem.hxx>
#include <editeng/wghtitem.hxx>
#include <editeng/postitem.hxx>
#include <editeng/udlnitem.hxx>
#include <editeng/crossedoutitem.hxx>
#include <editeng/shdditem.hxx>
#include <svx/xflbmsxy.hxx>
#include <svx/xlnclit.hxx>
#include <svx/xlncapit.hxx>
#include <svx/xlnwtit.hxx>
#include <svx/xflclit.hxx>
#include <editeng/fontitem.hxx>
#include <editeng/wrlmitem.hxx>
#include <editeng/contouritem.hxx>
#include <editeng/colritem.hxx>
#include <vcl/metric.hxx>
#include <editeng/charscaleitem.hxx>
#include <editeng/kernitem.hxx>
#include <svx/sdtfchim.hxx>
#include <svx/sdtditm.hxx>
#include <svx/sdasitm.hxx>
#include <svx/sdtagitm.hxx>
#include <svx/sdtfsitm.hxx>
#include <svx/svdmodel.hxx>
#include <svx/svdpage.hxx>
#include <string>
#include <string_view>
#include <svx/svdouno.hxx>
#include <svx/svdobjkind.hxx>
#include <com/sun/star/beans/XPropertySet.hpp>
#include <com/sun/star/beans/XPropertySetInfo.hpp>
#include <cpo/uno/Any.hxx>
#include <cpo/uno/Sequence.hxx>
#include <vcl/pdf/PDFAnnotationSubType.hxx>
#include <vcl/pdf/PDFFormFieldType.hxx>
#include <svx/svdobj.hxx>
#include <svx/svdotext.hxx>
#include <svx/svdorect.hxx>
#include <svx/svdograf.hxx>
#include <svx/svdopath.hxx>
#include <svx/svdetc.hxx>
#include <svl/itemset.hxx>
#include <basegfx/polygon/b2dpolygon.hxx>
#include <basegfx/polygon/b2dpolygontools.hxx>
#include <tools/helpers.hxx>
#include <basegfx/matrix/b2dhommatrix.hxx>
#include <basegfx/matrix/b2dhommatrixtools.hxx>
#include <svx/xlinjoit.hxx>
#include <svx/xlndsit.hxx>
#include <basegfx/polygon/b2dpolygonclipper.hxx>
#include <svx/xbtmpit.hxx>
#include <svx/xfillit0.hxx>
#include <svx/xflbmtit.hxx>
#include <svx/xflbstit.hxx>
#include <svx/xlineit0.hxx>
#include <basegfx/polygon/b2dpolypolygontools.hxx>
#include <svx/svditer.hxx>
#include <svx/svdogrp.hxx>
#include <vcl/dibtools.hxx>
#include <sal/log.hxx>
#include <o3tl/string_view.hxx>
#include <osl/diagnose.h>
#include <osl/file.hxx>
#include <unicode/normalizer2.h>
#include <set>

using namespace com::sun::star;

static OUString getPrefix(void* p)
{
    static sal_Int64 snCounter = 0;
    return OUString::number(reinterpret_cast<sal_IntPtr>(p)) + "_" + OUString::number(snCounter++);
}

ImpSdrPdfImport::ImpSdrPdfImport(SdrModel& rModel, SdrLayerID nLay, const tools::Rectangle& rRect,
                                 Graphic const& rGraphic, bool bSkipEmbeddedFonts,
                                 std::shared_ptr<ImportedFontMap>* pSharedFonts)
    : maScaleRect(rRect)
    , mnMapScalingOfs(0)
    , mpModel(&rModel)
    , mnLayer(nLay)
    , mnLineWidth(0)
    , maDash(css::drawing::DashStyle_RECT, 0, 0, 0, 0, 0)
    , mbMov(false)
    , mbSize(false)
    , maOfs(0, 0)
    , mfScaleX(1.0)
    , mfScaleY(1.0)
    , maScaleX(1.0)
    , maScaleY(1.0)
    , mbFntDirty(true)
    , mbLastObjWasPolyWithoutLine(false)
    , mbNoLine(false)
    , mbNoFill(false)
    , mnPageCount(0)
    , mdPageHeightPts(0)
    , mbSkipEmbeddedFonts(bSkipEmbeddedFonts)
    , mpPDFium(vcl::pdf::PDFiumLibrary::get())
{
    mpLineAttr = std::make_unique<SfxItemSet>(
        SfxItemSet::makeFixedSfxItemSet<XATTR_LINE_FIRST, XATTR_LINE_LAST>(rModel.GetItemPool()));
    mpFillAttr = std::make_unique<SfxItemSet>(
        SfxItemSet::makeFixedSfxItemSet<XATTR_FILL_FIRST, XATTR_FILL_LAST>(rModel.GetItemPool()));
    mpTextAttr = std::make_unique<SfxItemSet>(
        SfxItemSet::makeFixedSfxItemSet<EE_ITEMS_START, EE_ITEMS_END>(rModel.GetItemPool()));

    // Load the buffer using pdfium.
    auto const& rVectorGraphicData = rGraphic.getVectorGraphicData();
    const auto* pData = rVectorGraphicData->getBinaryDataContainer().getData();
    sal_Int32 nSize = rVectorGraphicData->getBinaryDataContainer().getSize();
    mpPdfDocument = mpPDFium ? mpPDFium->openDocument(pData, nSize, OString()) : nullptr;
    if (!mpPdfDocument)
        return;

    mnPageCount = mpPdfDocument->getPageCount();

    const std::shared_ptr<GfxLink> xGrfLink = rGraphic.GetSharedGfxLink();
    if (xGrfLink && !mbSkipEmbeddedFonts)
        mxImportedFonts = xGrfLink->getImportedFonts();
    else if (mbSkipEmbeddedFonts && pSharedFonts && *pSharedFonts)
        mxImportedFonts = *pSharedFonts; // the previous page of this decompose collected it
    if (!mxImportedFonts)
    {
        mxImportedFonts
            = std::make_shared<ImportedFontMap>(
                CollectFonts(getPrefix(this), *mpPdfDocument, mbSkipEmbeddedFonts));
        // A skip-fonts map is family-name-only; do not cache it onto the link
        // where a later faithful render would reuse it — hand it to the
        // caller's shared slot instead, so the next page skips the walk.
        if (xGrfLink && !mbSkipEmbeddedFonts)
            xGrfLink->setImportedFonts(mxImportedFonts);
        else if (mbSkipEmbeddedFonts && pSharedFonts)
            *pSharedFonts = mxImportedFonts;
    }

    // Same as SdModule
    mpVD = VclPtr<VirtualDevice>::Create();
    mpVD->SetReferenceDevice(VirtualDevice::RefDevMode::Dpi600);
    mpVD->SetMapMode(MapMode(MapUnit::Map100thMM));
    mpVD->EnableOutput(false);
    mpVD->SetLineColor();

    // Get TextBounds relative to baseline
    vcl::Font aFnt = mpVD->GetFont();
    aFnt.SetAlignment(ALIGN_BASELINE);
    aFnt.SetFamily(FAMILY_DONTKNOW);
    mpVD->SetFont(aFnt);
}

ImpSdrPdfImport::~ImpSdrPdfImport() = default;

namespace
{
OUString GetPostScriptName(const OUString& rBaseFontName)
{
    OUString sPostScriptName = rBaseFontName;
    /* For a font subset, the PostScript name of the font—the value of the
         * font’s BaseFont entry and the font descriptor’s FontName entry shall
         * begin with a tag followed by a plus sign (+). The tag shall consist of
         * exactly six uppercase letters; the choice of letters is arbitrary, but
         * different subsets in the same PDF file shall have different tags */
    if (sPostScriptName.getLength() > 6 && sPostScriptName[6] == '+')
        sPostScriptName = sPostScriptName.copy(7);
    return sPostScriptName;
}

bool writeFontFile(const OUString& fileUrl, const std::vector<uint8_t>& rFontData)
{
    SAL_INFO("sd.filter", "dumping to: " << fileUrl);

    osl::File file(fileUrl);
    switch (file.open(osl_File_OpenFlag_Create | osl_File_OpenFlag_Write))
    {
        case osl::File::E_None:
            break; // ok
        case osl::File::E_EXIST:
            return true; // Assume it's already been added correctly.
        default:
            SAL_WARN("sd.filter", "Cannot open file for temporary font");
            return false;
    }
    sal_uInt64 writtenTotal = 0;
    while (writtenTotal < rFontData.size())
    {
        sal_uInt64 written;
        if (file.write(rFontData.data() + writtenTotal, rFontData.size() - writtenTotal, written)
            != osl::File::E_None)
        {
            SAL_WARN("sd.filter", "Error writing temporary font file");
            osl::File::remove(fileUrl);
            return false;
        }
        writtenTotal += written;
    }

    return true;
}

// A PostScript style suffix names a point on the WHOLE weight ladder
// ("Medium", "SemiBold", "Semi-Bold", "ExtraBold", "Black", "Light", "Thin"),
// with or without a trailing Italic/Oblique. Mapping only Regular and Bold
// re-exported every Medium/SemiBold run of the product's one-pagers as
// Regular (WEIGHT_DONTKNOW -> the config default) — headline and stat
// numerals came back visibly lighter after an edit.
FontWeight toOfficeWeight(std::string_view style)
{
    std::string aNorm;
    aNorm.reserve(style.size());
    for (char c : style)
    {
        if (c == ' ' || c == '-' || c == '_')
            continue;
        aNorm.push_back((c >= 'A' && c <= 'Z') ? static_cast<char>(c + ('a' - 'A')) : c);
    }
    for (const char* pSuffix : { "italic", "oblique" })
    {
        const std::string_view aSuffix(pSuffix);
        if (aNorm.size() >= aSuffix.size()
            && std::string_view(aNorm).substr(aNorm.size() - aSuffix.size()) == aSuffix)
            aNorm.erase(aNorm.size() - aSuffix.size());
    }
    if (aNorm.empty() || aNorm == "regular" || aNorm == "normal" || aNorm == "book"
        || aNorm == "roman" || aNorm == "text")
        return WEIGHT_NORMAL;
    if (aNorm == "thin" || aNorm == "hairline")
        return WEIGHT_THIN;
    if (aNorm == "extralight" || aNorm == "ultralight")
        return WEIGHT_ULTRALIGHT;
    if (aNorm == "light")
        return WEIGHT_LIGHT;
    if (aNorm == "semilight" || aNorm == "demilight")
        return WEIGHT_SEMILIGHT;
    if (aNorm == "medium")
        return WEIGHT_MEDIUM;
    if (aNorm == "semibold" || aNorm == "demibold")
        return WEIGHT_SEMIBOLD;
    if (aNorm == "bold")
        return WEIGHT_BOLD;
    if (aNorm == "extrabold" || aNorm == "ultrabold")
        return WEIGHT_ULTRABOLD;
    if (aNorm == "black" || aNorm == "heavy" || aNorm == "extrablack" || aNorm == "ultrablack")
        return WEIGHT_BLACK;
    return WEIGHT_DONTKNOW;
}

OUString stripPostScriptStyle(const OUString& postScriptName, FontWeight& eWeight)
{
    OUString sFontName;
    sal_Int32 lastDash = postScriptName.lastIndexOf('-');
    if (lastDash == -1)
    {
        sFontName = postScriptName;
        eWeight = WEIGHT_NORMAL;
    }
    else
    {
        sFontName = postScriptName.copy(0, lastDash);
        eWeight = toOfficeWeight(postScriptName.copy(lastDash + 1).toUtf8());
    }
    return sFontName;
}

OUString getFileUrlForTemporaryFont(std::u16string_view prefix, std::u16string_view name,
                                    std::u16string_view suffix)
{
    return EmbeddedFontsManager::getFileUrlForTemporaryFont(
        Concat2View(OUString::Concat(prefix) + name), suffix);
}
}

// Possibly there is some alternative route to query pdfium for all fonts without
// iterating through every object to see what font each uses
namespace
{
// Defined with the segment helpers further down (same unnamed namespace).
bool lcl_StandardFontFamily(const OUString& rName, OUString& rFamily, FontWeight& rWeight,
                            bool& rItalic);
}

ImportedFontMap ImpSdrPdfImport::CollectFonts(std::u16string_view sPrefix,
                                              vcl::pdf::PDFiumDocument& rPdfDocument,
                                              bool bSkipEmbeddedFonts)
{
    ImportedFontMap aImportedFonts;

    std::map<OUString, SubSetInfo> aDifferentSubsetsForFont;
    // map of PostScriptName->Merged Font File for that font
    std::map<OUString, EmbeddedFontInfo> aEmbeddedFonts;

    const int nPageCount = rPdfDocument.getPageCount();

    for (int nPageIndex = 0; nPageIndex < nPageCount; ++nPageIndex)
    {
        auto pPdfPage = rPdfDocument.openPage(nPageIndex);
        if (!pPdfPage)
        {
            SAL_WARN("sd.filter", "ImpSdrPdfImport missing page: " << nPageIndex);
            continue;
        }
        // (No text page: the walk reads each text object's font, not its
        // text, and building one per page doubled the cost of the walk.)

        const int nPageObjectCount = pPdfPage->getObjectCount();
        for (int nPageObjectIndex = 0; nPageObjectIndex < nPageObjectCount; ++nPageObjectIndex)
        {
            auto pPageObject = pPdfPage->getObject(nPageObjectIndex);
            if (!pPageObject)
            {
                SAL_WARN("sd.filter", "ImpSdrPdfImport missing object: "
                                          << nPageObjectIndex << " on page: " << nPageIndex);
                continue;
            }

            const vcl::pdf::PDFPageObjectType ePageObjectType = pPageObject->getType();
            if (ePageObjectType != vcl::pdf::PDFPageObjectType::Text)
                continue;
            std::unique_ptr<vcl::pdf::PDFiumFont> font = pPageObject->getFont();
            if (!font)
                continue;

            auto itImportedFont = aImportedFonts.find(font->getFontDictObjNum());
            if (itImportedFont == aImportedFonts.end())
            {
                OUString sPostScriptName = GetPostScriptName(pPageObject->getBaseFontName());

                OUString sFontName = pPageObject->getFontName();

                FontWeight eFontWeight(WEIGHT_DONTKNOW);
                OUString sPostScriptFontFamily = stripPostScriptStyle(sPostScriptName, eFontWeight);

                if (sFontName.isEmpty())
                {
                    sFontName = sPostScriptFontFamily;
                    SAL_WARN("sd.filter",
                             "missing font name, attempt to reconstruct from postscriptname as: "
                                 << sFontName);
                }

                if (!font->getIsEmbedded() || bSkipEmbeddedFonts)
                {
                    SAL_WARN("sd.filter", "mapping font by family (embedded="
                                              << font->getIsEmbedded() << ", skip="
                                              << bSkipEmbeddedFonts << "): " << sFontName << " to "
                                              << sPostScriptFontFamily);
                    // A standard-14 family the PDF did not embed is recorded
                    // as its bundled METRIC TWIN (Liberation Sans/Serif/Mono):
                    // left as "Helvetica", the jail's fontconfig — no alias
                    // rules — laid the text out in DejaVu Sans, up to 13%
                    // wider, and the client drew Helvetica into those
                    // advances ("m emos"). The style suffix keeps its weight;
                    // the slant rides the name (see lcl_StandardFontFamily).
                    OUString sMappedFamily = sPostScriptFontFamily;
                    bool bNameItalic = false;
                    FontWeight eMappedWeight = eFontWeight;
                    if (lcl_StandardFontFamily(sPostScriptName, sMappedFamily, eMappedWeight,
                                               bNameItalic))
                    {
                        sPostScriptFontFamily = sMappedFamily;
                        if (eFontWeight == WEIGHT_DONTKNOW)
                            eFontWeight = eMappedWeight;
                    }
                    aImportedFonts.insert(OfficeFontInfo{ font->getFontDictObjNum(),
                                                          sPostScriptFontFamily, eFontWeight });
                    continue;
                }

                std::vector<uint8_t> aFontData;
                if (!font->getFontData(aFontData) || aFontData.empty())
                {
                    SAL_WARN("sd.filter", "that's worrying, skipping " << sFontName);
                    continue;
                }

                SubSetInfo* pSubSetInfo;

                SAL_INFO("sd.filter", "importing font: " << font);
                auto itFontName = aDifferentSubsetsForFont.find(sPostScriptName);
                OUString sFontFileName = sPostScriptName;
                if (itFontName != aDifferentSubsetsForFont.end())
                {
                    sFontFileName += OUString::number(itFontName->second.aComponents.size());
                    itFontName->second.aComponents.emplace_back();
                    pSubSetInfo = &itFontName->second;
                }
                else
                {
                    sFontFileName += "0";
                    SubSetInfo aSubSetInfo;
                    aSubSetInfo.aComponents.emplace_back();
                    auto result
                        = aDifferentSubsetsForFont.emplace(sPostScriptName, aSubSetInfo).first;
                    pSubSetInfo = &result->second;
                }
                bool bTTF = EmbeddedFontsManager::analyzeTTF(aFontData.data(), aFontData.size(),
                                                             eFontWeight);
                SAL_INFO_IF(!bTTF, "sd.filter", "not ttf/otf, converting");
                OUString fileUrl
                    = getFileUrlForTemporaryFont(sPrefix, sFontFileName, bTTF ? u".ttf" : u".t1");
                if (!writeFontFile(fileUrl, aFontData))
                    SAL_WARN("sd.filter", "ttf not written");
                else
                    SAL_INFO("sd.filter", "ttf written to: " << fileUrl);
                std::vector<uint8_t> aToUnicodeData;
                if (!font->getFontToUnicode(aToUnicodeData))
                    SAL_WARN("sd.filter", "that's maybe worrying");
                if (!bTTF || !aToUnicodeData.empty())
                {
                    EmbeddedFontInfo fontInfo
                        = convertToOTF(sPrefix, *pSubSetInfo, fileUrl, sFontName, sPostScriptName,
                                       sFontFileName, aToUnicodeData, *font);
                    fileUrl = fontInfo.sFontFile;
                    sFontName = fontInfo.sFontName;
                    eFontWeight = fontInfo.eFontWeight;
                }

                if (fileUrl.getLength())
                {
                    aImportedFonts.insert(
                        OfficeFontInfo{ font->getFontDictObjNum(), sFontName, eFontWeight });
                    aEmbeddedFonts[sPostScriptName]
                        = EmbeddedFontInfo{ sFontName, fileUrl, eFontWeight };
                }
            }
            else
            {
                SAL_INFO("sd.filter", "already saw font " << font << " and used "
                                                          << itImportedFont->sFontName
                                                          << " as name");
            }
        }
    }

    if (!aEmbeddedFonts.empty())
    {
        EmbeddedFontsManager aEmbeddedFontsManager(nullptr);
        for (const auto& fontinfo : aEmbeddedFonts)
        {
            aEmbeddedFontsManager.addEmbeddedFont(fontinfo.second.sFontFile,
                                                  fontinfo.second.sFontName, true);
        }
    }

    return aImportedFonts;
}

namespace
{
/// Does a BGRA pdfium bitmap hold any pixel that is not fully transparent?
/// (Another format has no alpha to tell by: taken as drawn.)
bool lcl_AnyPixelDrawn(vcl::pdf::PDFiumBitmap& rBitmap)
{
    if (rBitmap.getFormat() != vcl::pdf::PDFBitmapType::BGRA)
        return true;
    const ConstScanline pBuffer = rBitmap.getBuffer();
    const int nWidth = rBitmap.getWidth();
    const int nHeight = rBitmap.getHeight();
    const int nStride = rBitmap.getStride();
    if (!pBuffer || nWidth <= 0 || nHeight <= 0 || nStride < nWidth * 4)
        return true;
    for (int nY = 0; nY < nHeight; ++nY)
    {
        const sal_uInt8* pRow = pBuffer + static_cast<size_t>(nY) * nStride;
        for (int nX = 0; nX < nWidth; ++nX)
            if (pRow[4 * nX + 3] != 0)
                return true;
    }
    return false;
}

/// Is every pixel of a BGRA pdfium bitmap fully opaque?
bool lcl_AllPixelsOpaque(vcl::pdf::PDFiumBitmap& rBitmap)
{
    if (rBitmap.getFormat() != vcl::pdf::PDFBitmapType::BGRA)
        return false;
    const ConstScanline pBuffer = rBitmap.getBuffer();
    const int nWidth = rBitmap.getWidth();
    const int nHeight = rBitmap.getHeight();
    const int nStride = rBitmap.getStride();
    if (!pBuffer || nWidth <= 0 || nHeight <= 0 || nStride < nWidth * 4)
        return false;
    for (int nY = 0; nY < nHeight; ++nY)
    {
        const sal_uInt8* pRow = pBuffer + static_cast<size_t>(nY) * nStride;
        for (int nX = 0; nX < nWidth; ++nX)
            if (pRow[4 * nX + 3] != 0xFF)
                return false;
    }
    return true;
}

/// JPEG passthrough: the image's own JPEG stream, when that is exactly what
/// pdfium draws for it, as a Graphic that carries the bytes as its NativeJpg
/// GfxLink (GraphicFilter::ImportGraphic sets the link for every linkable
/// format). The PDF export can then write the stream through (see
/// PDFExtOutDevData::HasAdequateCompression) instead of re-encoding the
/// decoded pixels on every save: generation loss, and a bigger file. An
/// empty Graphic means "take the rendered bitmap", as before.
///
/// Exactness is proven on the object, not assumed. pdfium's public API
/// cannot read an image's /SMask, /Mask, /Decode or /DecodeParms, so the
/// image is rendered once at exactly its own pixel size (an integer matrix:
/// one device pixel per sample, no edge coverage) with everything pdfium
/// applies - soft mask, colour key or stencil mask, clip, fill alpha,
/// /Decode, the colour space. Every pixel must come out opaque (nothing is
/// masked, clipped or transparent), and the JPEG as vcl decodes it must
/// match that render within what two JPEG decoders differ by (an inverted
/// /Decode, a /ColorTransform override, a non-sRGB ICC profile or a
/// mislabelled colour space change what pdfium shows while the bytes stay
/// the same).
Graphic lcl_ImportPassthroughJpeg(vcl::pdf::PDFiumPageObject& rObject, vcl::pdf::PDFiumPage& rPage,
                                  vcl::pdf::PDFiumDocument& rDoc)
{
    // The probe is a 32-bit render of the whole image: 64 MB at most (a
    // 12 MP photo, a 300 dpi page scan), freed before the next image.
    constexpr double fProbePixelBudget = 16.0e6;
    // Mean absolute difference per channel (0-255) between vcl's decode and
    // pdfium's render: decoder rounding and chroma upsampling stay near 1.
    constexpr double fMaxMeanDifference = 3.0;
    // Colour comparison on a grid of at most this many samples a side: every
    // effect it looks for applies to the whole image.
    constexpr int nCompareGrid = 256;

    // One filter, DCTDecode ("DCT" is its inline-image abbreviation): the
    // raw stream is then a JPEG file. A chain (Flate over DCT) is not.
    const std::vector<OString> aFilters = rObject.getImageFilters();
    if (aFilters.size() != 1 || (aFilters[0] != "DCTDecode" && aFilters[0] != "DCT"))
        return Graphic();

    // The export writes a JPEG as DeviceRGB or DeviceGray. An ICC-based
    // image is let through to the comparison, which rejects any profile
    // that moves colours; CMYK, Lab, Separation, DeviceN and the rest keep
    // the rendered bitmap.
    const vcl::pdf::PDFImageColorSpace eColorSpace = rObject.getImageColorSpace(rPage);
    if (eColorSpace != vcl::pdf::PDFImageColorSpace::DeviceGray
        && eColorSpace != vcl::pdf::PDFImageColorSpace::DeviceRGB
        && eColorSpace != vcl::pdf::PDFImageColorSpace::ICCBased)
        return Graphic();

    // Upright: the JPEG's first row is the drawn image's top row only when
    // the matrix neither rotates, shears nor mirrors it (image space puts
    // the first sample row at the top of the unit square). ImportImage
    // places the picture in the object's bounds, like the rendered bitmap.
    const basegfx::B2DHomMatrix aMatrix = rObject.getMatrix();
    if (!(aMatrix.a() > 0.0 && aMatrix.d() > 0.0 && aMatrix.b() == 0.0 && aMatrix.c() == 0.0))
        return Graphic();

    const Size aPixels = rObject.getImageSize(rPage);
    const int nWidth = aPixels.Width();
    const int nHeight = aPixels.Height();
    if (nWidth <= 0 || nHeight <= 0
        || static_cast<double>(nWidth) * static_cast<double>(nHeight) > fProbePixelBudget)
        return Graphic();

    std::vector<sal_uInt8> aJpeg = rObject.getImageDataRaw();
    if (aJpeg.size() < 4 || aJpeg[0] != 0xFF || aJpeg[1] != 0xD8)
        return Graphic();
    SvMemoryStream aStream(aJpeg.data(), aJpeg.size(), StreamMode::READ);
    {
        // One or three components, at the size the PDF gives: a CMYK or
        // YCCK JPEG never passes through (HasAdequateCompression refuses
        // four components too, and vcl's CMYK conversion is not pdfium's).
        GraphicDescriptor aDescriptor(aStream, nullptr);
        if (!aDescriptor.Detect(true) || aDescriptor.GetFileFormat() != GraphicFileFormat::JPG
            || (aDescriptor.GetNumberOfImageComponents() != 1
                && aDescriptor.GetNumberOfImageComponents() != 3)
            || aDescriptor.GetSizePixel() != aPixels)
            return Graphic();
    }
    aStream.Seek(0);
    Graphic aGraphic;
    if (GraphicFilter::GetGraphicFilter().ImportGraphic(aGraphic, u"", aStream) != ERRCODE_NONE
        || !aGraphic.IsGfxLink() || aGraphic.GetGfxLink().GetType() != GfxLinkType::NativeJpg)
        return Graphic();
    const Bitmap aDecoded = aGraphic.GetBitmap();
    if (aDecoded.GetSizePixel() != aPixels)
        return Graphic();

    // The probe render, the object's matrix put back after it.
    rObject.setMatrix(basegfx::B2DHomMatrix::abcdef(nWidth, 0.0, 0.0, nHeight, 0.0, 0.0));
    std::unique_ptr<vcl::pdf::PDFiumBitmap> pProbe = rObject.getRenderedImage(rDoc, rPage);
    rObject.setMatrix(aMatrix);
    if (!pProbe || pProbe->getWidth() != nWidth || pProbe->getHeight() != nHeight
        || !lcl_AllPixelsOpaque(*pProbe))
        return Graphic();

    BitmapScopedReadAccess pAccess(aDecoded);
    if (!pAccess)
        return Graphic();
    const ConstScanline pProbeBuffer = pProbe->getBuffer();
    const int nProbeStride = pProbe->getStride();
    const int nStepX = std::max(1, nWidth / nCompareGrid);
    const int nStepY = std::max(1, nHeight / nCompareGrid);
    double fDifference = 0.0;
    sal_Int64 nSamples = 0;
    for (int nY = 0; nY < nHeight; nY += nStepY)
    {
        const sal_uInt8* pRow = pProbeBuffer + static_cast<size_t>(nY) * nProbeStride;
        for (int nX = 0; nX < nWidth; nX += nStepX)
        {
            // pdfium's BGRA: blue, green, red, alpha.
            const sal_uInt8* pPixel = pRow + 4 * nX;
            const BitmapColor aColor = pAccess->GetColor(nY, nX);
            fDifference += std::abs(static_cast<int>(aColor.GetRed()) - static_cast<int>(pPixel[2]))
                           + std::abs(static_cast<int>(aColor.GetGreen()) - static_cast<int>(pPixel[1]))
                           + std::abs(static_cast<int>(aColor.GetBlue()) - static_cast<int>(pPixel[0]));
            ++nSamples;
        }
    }
    if (nSamples == 0 || fDifference / (3.0 * nSamples) > fMaxMeanDifference)
    {
        SAL_INFO("sd.filter", "PDF image import: JPEG not passed through, its decode differs from "
                              "pdfium's render by "
                                  << (nSamples ? fDifference / (3.0 * nSamples) : 0.0));
        return Graphic();
    }
    return aGraphic;
}

/// The largest image, in samples, imported at its own resolution: a letter
/// page scanned at 400 dpi. Past it the importer's display budget applies.
constexpr double fNativePixelBudget = 16.0e6;

/// A fully opaque BGRA pdfium bitmap in the smallest form that holds it
/// exactly: two colours as a two-entry palette (a bilevel scan: the PDF
/// export writes it back at 1 bit per pixel), shades of grey as an 8-bit grey
/// palette, anything else as 24-bit RGB - never as 32-bit with an alpha
/// channel nobody uses (which the export writes as RGB plus a soft mask).
/// A bitmap with any transparency comes back as the usual 32-bit bitmap.
Bitmap lcl_CompactBitmap(vcl::pdf::PDFiumBitmap& rBitmap)
{
    if (!lcl_AllPixelsOpaque(rBitmap))
        return rBitmap.createBitmapFromBuffer();
    const ConstScanline pBuffer = rBitmap.getBuffer();
    const int nWidth = rBitmap.getWidth();
    const int nHeight = rBitmap.getHeight();
    const int nStride = rBitmap.getStride();
    // pdfium's BGRA: blue, green, red, alpha.
    const auto colourAt = [&](int nX, int nY) {
        const sal_uInt8* pPixel = pBuffer + static_cast<size_t>(nY) * nStride + 4 * nX;
        return Color(pPixel[2], pPixel[1], pPixel[0]);
    };
    std::vector<Color> aColours;
    bool bGrey = true;
    for (int nY = 0; nY < nHeight && (aColours.size() <= 2 || bGrey); ++nY)
        for (int nX = 0; nX < nWidth; ++nX)
        {
            const Color aColour = colourAt(nX, nY);
            if (aColour.GetRed() != aColour.GetGreen() || aColour.GetRed() != aColour.GetBlue())
                bGrey = false;
            if (aColours.size() <= 2
                && std::find(aColours.begin(), aColours.end(), aColour) == aColours.end())
                aColours.push_back(aColour);
            if (aColours.size() > 2 && !bGrey)
                break;
        }
    const Size aSize(nWidth, nHeight);
    if (aColours.size() <= 2)
    {
        if (aColours.empty())
            aColours.push_back(COL_WHITE);
        if (aColours.size() == 1)
            aColours.push_back(aColours.front());
        // darker first: index 0 is the ink of a bilevel scan
        if (aColours[0].GetLuminance() > aColours[1].GetLuminance())
            std::swap(aColours[0], aColours[1]);
        const BitmapPalette aPalette{ BitmapColor(aColours[0]), BitmapColor(aColours[1]) };
        Bitmap aOut(aSize, vcl::PixelFormat::N8_BPP, &aPalette);
        {
            BitmapScopedWriteAccess pWrite(aOut);
            if (!pWrite)
                return rBitmap.createBitmapFromBuffer();
            for (int nY = 0; nY < nHeight; ++nY)
            {
                Scanline pLine = pWrite->GetScanline(nY);
                for (int nX = 0; nX < nWidth; ++nX)
                    pWrite->SetPixelOnData(
                        pLine, nX,
                        BitmapColor(static_cast<sal_uInt8>(colourAt(nX, nY) == aColours[0] ? 0 : 1)));
            }
        }
        return aOut;
    }
    if (bGrey)
    {
        Bitmap aOut(aSize, vcl::PixelFormat::N8_BPP, &Bitmap::GetGreyPalette(256));
        {
            BitmapScopedWriteAccess pWrite(aOut);
            if (!pWrite)
                return rBitmap.createBitmapFromBuffer();
            for (int nY = 0; nY < nHeight; ++nY)
            {
                Scanline pLine = pWrite->GetScanline(nY);
                for (int nX = 0; nX < nWidth; ++nX)
                    pWrite->SetPixelOnData(pLine, nX, BitmapColor(colourAt(nX, nY).GetRed()));
            }
        }
        return aOut;
    }
    Bitmap aOut(aSize, vcl::PixelFormat::N24_BPP);
    {
        BitmapScopedWriteAccess pWrite(aOut);
        if (!pWrite)
            return rBitmap.createBitmapFromBuffer();
        for (int nY = 0; nY < nHeight; ++nY)
        {
            Scanline pLine = pWrite->GetScanline(nY);
            for (int nX = 0; nX < nWidth; ++nX)
                pWrite->SetPixelOnData(pLine, nX, BitmapColor(colourAt(nX, nY)));
        }
    }
    return aOut;
}

/// A bilevel image (1 bit per pixel: CCITT, JBIG2, a 1-bit Flate stream) at
/// its own resolution, as a two-entry palette bitmap - never widened to
/// 32-bit BGRA and never scaled to the display budget, so a fax or a
/// black-and-white page scan keeps every sample and the PDF export writes it
/// back losslessly at 1 bit per pixel (a 1-bit Flate stream).
///
/// As for the JPEG passthrough, exactness is proven on the object: the image
/// is rendered once at exactly its own pixel size (an upright matrix, one
/// device pixel per sample), with everything pdfium applies - /Decode,
/// BlackIs1, the colour space, masks, clip. Every pixel must come out opaque
/// and in at most two colours; a stencil mask (transparent where unpainted),
/// a clipped or a rotated placement keeps the rendered bitmap.
Graphic lcl_ImportBilevel(vcl::pdf::PDFiumPageObject& rObject, vcl::pdf::PDFiumPage& rPage,
                          vcl::pdf::PDFiumDocument& rDoc)
{
    if (rObject.getImageBitsPerPixel(rPage) != 1)
        return Graphic();
    const basegfx::B2DHomMatrix aMatrix = rObject.getMatrix();
    if (!(aMatrix.a() > 0.0 && aMatrix.d() > 0.0 && aMatrix.b() == 0.0 && aMatrix.c() == 0.0))
        return Graphic();
    const Size aPixels = rObject.getImageSize(rPage);
    const int nWidth = aPixels.Width();
    const int nHeight = aPixels.Height();
    if (nWidth <= 0 || nHeight <= 0
        || static_cast<double>(nWidth) * static_cast<double>(nHeight) > fNativePixelBudget)
        return Graphic();
    rObject.setMatrix(basegfx::B2DHomMatrix::abcdef(nWidth, 0.0, 0.0, nHeight, 0.0, 0.0));
    std::unique_ptr<vcl::pdf::PDFiumBitmap> pProbe = rObject.getRenderedImage(rDoc, rPage);
    rObject.setMatrix(aMatrix);
    if (!pProbe || pProbe->getWidth() != nWidth || pProbe->getHeight() != nHeight
        || !lcl_AllPixelsOpaque(*pProbe))
        return Graphic();
    Bitmap aBitmap = lcl_CompactBitmap(*pProbe);
    if (aBitmap.getPixelFormat() != vcl::PixelFormat::N8_BPP || aBitmap.GetSizePixel() != aPixels)
        return Graphic();
    {
        // two colours, not a grey ramp: the compaction's palette says which
        BitmapScopedReadAccess pRead(aBitmap);
        if (!pRead || !pRead->HasPalette() || pRead->GetPaletteEntryCount() != 2)
            return Graphic();
    }
    return Graphic(aBitmap);
}

/// The innermost /VulcanImg mark's VulcanId, or empty.
OUString lcl_VulcanImageId(vcl::pdf::PDFiumPageObject& rObject)
{
    OUString aId;
    for (const auto& rMark : rObject.getMarks("VulcanId"_ostr))
        if (rMark.first == "VulcanImg" && !rMark.second.isEmpty())
            aId = rMark.second; // pdfium lists outermost first: the last one wins
    return aId;
}
}

void ImpSdrPdfImport::DoObjects(SvdProgressInfo* pProgrInfo, sal_uInt32* pActionsToReport,
                                int nPageIndex)
{
    const int nPageCount = mpPdfDocument->getPageCount();
    if (!(nPageCount > 0 && nPageIndex >= 0 && nPageIndex < nPageCount))
        return;

    // Render next page.
    auto pPdfPage = mpPdfDocument->openPage(nPageIndex);
    if (!pPdfPage)
        return;

    basegfx::B2DSize dPageSize = mpPdfDocument->getPageSize(nPageIndex);

    SetupPageScale(dPageSize.getWidth(), dPageSize.getHeight());

    // Load the page text to extract it when we get text elements.
    auto pTextPage = pPdfPage->getTextPage();
    maPageChars.clear();
    maPageNonSpace.clear();
    mnPageRunCursor = 0;
    mpPageCharsFor = nullptr; // a new page's glyphs (the text page may reuse an address)

    const int nPageObjectCount = pPdfPage->getObjectCount();
    if (pProgrInfo)
        pProgrInfo->SetActionCount(nPageObjectCount);

    for (int nPageObjectIndex = 0; nPageObjectIndex < nPageObjectCount; ++nPageObjectIndex)
    {
        auto pPageObject = pPdfPage->getObject(nPageObjectIndex);
        ImportPdfObject(pPageObject, pPdfPage, pTextPage, nPageObjectIndex);
        if (pProgrInfo && pActionsToReport)
        {
            (*pActionsToReport)++;

            if (*pActionsToReport >= 16)
            {
                if (!pProgrInfo->ReportActions(*pActionsToReport))
                    break;

                *pActionsToReport = 0;
            }
        }
    }

    // AcroForm widgets are annotations, not page content, so the object loop
    // above never sees them: a fillable PDF used to open with its fields simply
    // gone, and save back without them. Import EVERY widget as the Draw FORM
    // CONTROL that the PDF export (ExportFormFields, set for drawing PDF saves)
    // writes back as the same kind of AcroForm field, at the widget rect, with
    // the field's name, value and flags: text fields, check boxes, radio
    // buttons (one group per field name), combo and list boxes (options and
    // selection) and push buttons. A signature field - and a widget pdfium
    // cannot type - has no form control: its appearance (a signed field's
    // signature, an unsigned field's box) comes in as a locked picture named
    // after the field, so the page still shows it; the export writes no /Sig.
    //
    // AcroForm field flags (ISO 32000-1, 12.7.3.1 and 12.7.4): bit n is
    // 1 << (n - 1); annotation flags (12.5.3) the same.
    constexpr int nFieldReadOnly = 1 << 0;
    constexpr int nFieldTextMultiLine = 1 << 12;
    constexpr int nFieldTextPassword = 1 << 13;
    constexpr int nFieldChoiceMultiSelect = 1 << 21;
    constexpr int nAnnotHidden = 1 << 1;
    constexpr int nAnnotNoView = 1 << 5;
    // A widget appearance rendered as a picture: two pixels per point, within
    // the same per-image pixel budget ImportImage keeps, and never wider or
    // taller than the 2^14 pixels pdfium's bitmaps are limited to.
    constexpr double fWidgetRenderScale = 2.0;
    constexpr double fWidgetPixelBudget = 4.0e6;
    constexpr int nWidgetMaxSide = 16384;
    const auto toPixels = [](double f) {
        return static_cast<int>(std::clamp(std::round(f), -1.0e9, 1.0e9));
    };
    const int nAnnotCount = pPdfPage->getAnnotationCount();
    for (int nAnnot = 0; nAnnot < nAnnotCount; ++nAnnot)
    {
        auto pAnnot = pPdfPage->getAnnotation(nAnnot);
        if (!pAnnot || pAnnot->getSubType() != vcl::pdf::PDFAnnotationSubType::Widget)
            continue;

        const basegfx::B2DRectangle aBounds = pAnnot->getRectangle();
        if (aBounds.isEmpty())
            continue;
        const tools::Rectangle aRect = PointsToLogic(aBounds.getMinX(), aBounds.getMaxX(),
                                                     aBounds.getMaxY(), aBounds.getMinY());
        const OUString aName = pAnnot->getFormFieldName(mpPdfDocument.get());
        // A Hidden or NoView widget (a script or calculation helper) is not
        // imported. The PDF export writes only the form controls it paints,
        // and it paints no invisible object, so a hidden control would be
        // dropped from the file on the first save anyway; the canvas must not
        // show (or report) a field that its save does not keep. Carrying /F
        // through needs the export side (svx view contact, formpdfexport,
        // AnyWidget, the PDF writer) to write a hidden widget; until then
        // this is a known loss of the canvas save.
        if ((pAnnot->getFlags() & (nAnnotHidden | nAnnotNoView)) != 0)
        {
            SAL_INFO("sd.filter", "PDF widget import: '" << aName
                                      << "' is hidden (/F Hidden or NoView); not imported");
            continue;
        }

        SdrObjKind eKind = SdrObjKind::NONE;
        OUString sService;
        const vcl::pdf::PDFFormFieldType eType = pAnnot->getFormFieldType(mpPdfDocument.get());
        switch (eType)
        {
            case vcl::pdf::PDFFormFieldType::TextField:
                eKind = SdrObjKind::FormEdit;
                sService = u"com.sun.star.form.component.TextField"_ustr;
                break;
            case vcl::pdf::PDFFormFieldType::CheckBox:
                eKind = SdrObjKind::FormCheckbox;
                sService = u"com.sun.star.form.component.CheckBox"_ustr;
                break;
            case vcl::pdf::PDFFormFieldType::RadioButton:
                eKind = SdrObjKind::FormRadioButton;
                sService = u"com.sun.star.form.component.RadioButton"_ustr;
                break;
            case vcl::pdf::PDFFormFieldType::ComboBox:
                eKind = SdrObjKind::FormCombobox;
                sService = u"com.sun.star.form.component.ComboBox"_ustr;
                break;
            case vcl::pdf::PDFFormFieldType::ListBox:
                eKind = SdrObjKind::FormListbox;
                sService = u"com.sun.star.form.component.ListBox"_ustr;
                break;
            case vcl::pdf::PDFFormFieldType::PushButton:
                eKind = SdrObjKind::FormButton;
                sService = u"com.sun.star.form.component.CommandButton"_ustr;
                break;
            default:
                break;
        }

        if (eKind == SdrObjKind::NONE)
        {
            // Signature (or untyped) widget: its appearance, as drawn.
            if (!mpPDFium)
                continue;
            // A widget bound to no AcroForm field (pdfium's field type -1):
            // FPDF_FFLDraw draws only widgets that have a form control, so
            // there is nothing to picture.
            if (static_cast<int>(eType) < 0)
                continue;
            const double fLongestPt = std::max(aBounds.getWidth(), aBounds.getHeight());
            if (!std::isfinite(fLongestPt) || fLongestPt <= 0.0)
                continue;
            double fScale = fWidgetRenderScale;
            const double fAreaPt = aBounds.getWidth() * aBounds.getHeight();
            if (fAreaPt > 0.0 && fAreaPt * fScale * fScale > fWidgetPixelBudget)
                fScale = std::sqrt(fWidgetPixelBudget / fAreaPt);
            // Each side too, before any bitmap exists: a degenerate rect
            // (1e9 x 0.001 pt) keeps within the area budget but asks for a
            // 2e9-pixel-wide bitmap, which pdfium refuses, and the retry in
            // PDFiumImpl::createBitmap then overflows its double-to-int
            // rescale (or, near 5e8, allocates gigabytes).
            if (fLongestPt * fScale > nWidgetMaxSide)
                fScale = nWidgetMaxSide / fLongestPt;
            int nWidth = std::clamp(toPixels(aBounds.getWidth() * fScale), 1, nWidgetMaxSide);
            int nHeight = std::clamp(toPixels(aBounds.getHeight() * fScale), 1, nWidgetMaxSide);
            // Where the widget lands on the page rendered at this scale, by
            // pdfium's own page-to-device mapping - the one FPDF_FFLDraw
            // draws with, CropBox origin and /Rotate applied. The page is
            // drawn turned back by its /Rotate, so the picture shows the
            // widget in the unrotated page space the rest of this import
            // places objects in (aRect); pdfium's page size is the displayed
            // one, so a quarter turn swaps it back. A mapping that does not
            // come out as the widget's upright rect is skipped, not guessed.
            const int nPageRotation = pPdfPage->getRotation();
            if (nPageRotation < 0 || nPageRotation > 3)
                continue;
            const int nRenderRotate = (4 - nPageRotation) % 4;
            const bool bQuarterTurn = (nPageRotation % 2) != 0;
            const int nPageSizeX = toPixels(
                (bQuarterTurn ? dPageSize.getHeight() : dPageSize.getWidth()) * fScale);
            const int nPageSizeY = toPixels(
                (bQuarterTurn ? dPageSize.getWidth() : dPageSize.getHeight()) * fScale);
            int nLeft = 0;
            int nTop = 0;
            int nRight = 0;
            int nBottom = 0;
            const auto inDeviceRange = [](int n) { return n > -1000000000 && n < 1000000000; };
            if (nPageSizeX <= 0 || nPageSizeY <= 0
                || !pPdfPage->pageToDevice(0, 0, nPageSizeX, nPageSizeY, nRenderRotate,
                                           aBounds.getMinX(), aBounds.getMaxY(), nLeft, nTop)
                || !pPdfPage->pageToDevice(0, 0, nPageSizeX, nPageSizeY, nRenderRotate,
                                           aBounds.getMaxX(), aBounds.getMinY(), nRight, nBottom)
                || !inDeviceRange(nLeft) || !inDeviceRange(nTop) || !inDeviceRange(nRight)
                || !inDeviceRange(nBottom) || std::abs((nRight - nLeft) - nWidth) > 2
                || std::abs((nBottom - nTop) - nHeight) > 2)
            {
                SAL_INFO("sd.filter", "PDF widget import: '"
                                          << aName << "' has no upright page mapping (page /Rotate "
                                          << nPageRotation << "); its appearance is not imported");
                continue;
            }
            const int nRequestedWidth = nWidth;
            const int nRequestedHeight = nHeight;
            std::unique_ptr<vcl::pdf::PDFiumBitmap> pBitmap
                = mpPDFium->createBitmap(nWidth, nHeight, /*nAlpha=*/1);
            // A bitmap createBitmap shrank would crop the appearance.
            if (!pBitmap || nWidth != nRequestedWidth || nHeight != nRequestedHeight)
                continue;
            pBitmap->fillRect(0, 0, nWidth, nHeight, 0x00000000);
            // The page shifted so the widget's top-left is the bitmap's origin.
            pBitmap->renderFormFields(mpPdfDocument.get(), pPdfPage.get(), -nLeft, -nTop,
                                      nPageSizeX, nPageSizeY, nRenderRotate);
            // Nothing drawn (an unsigned signature field with no appearance,
            // a field pdfium does not draw): no invisible locked picture.
            if (!lcl_AnyPixelDrawn(*pBitmap))
                continue;
            const Bitmap aBitmap = pBitmap->createBitmapFromBuffer();
            if (aBitmap.IsEmpty())
                continue;
            rtl::Reference<SdrGrafObj> pGraf = new SdrGrafObj(*mpModel, Graphic(aBitmap), aRect);
            pGraf->SetMergedItem(XLineStyleItem(drawing::LineStyle_NONE));
            pGraf->SetMergedItem(XFillStyleItem(drawing::FillStyle_NONE));
            if (!aName.isEmpty())
                pGraf->SetName(aName);
            pGraf->SetMoveProtect(true);
            pGraf->SetResizeProtect(true);
            InsertObj(pGraf.get(), false);
            continue;
        }

        // The form object factory (FmFormObj, attaches the model to the page's
        // forms) when it is registered; else a plain control object with the
        // same model.
        rtl::Reference<SdrObject> pObj
            = SdrObjFactory::MakeNewObject(*mpModel, SdrInventor::FmForm, eKind);
        SdrUnoObj* pUno = dynamic_cast<SdrUnoObj*>(pObj.get());
        if (!pUno)
        {
            rtl::Reference<SdrUnoObj> pPlain = new SdrUnoObj(*mpModel, sService);
            pUno = pPlain.get();
            pObj = pPlain.get();
        }
        pUno->SetLogicRect(aRect);

        const OUString aValue = pAnnot->getFormFieldValue(mpPdfDocument.get());
        const int nFieldFlags = pAnnot->getFormFieldFlags(mpPdfDocument.get());
        css::uno::Reference<css::beans::XPropertySet> xProps(pUno->GetUnoControlModel(),
                                                             css::uno::UNO_QUERY);
        css::uno::Reference<css::beans::XPropertySetInfo> xInfo;
        if (xProps.is())
            xInfo = xProps->getPropertySetInfo();
        // One property at a time, only where the model has it: a check box
        // model has no Border, a button no Text, and one refusal must not
        // cost the field its value.
        const auto setProp = [&xProps, &xInfo](const OUString& rProp, const cpo::uno::Any& rValue) {
            if (!xInfo.is() || !xInfo->hasPropertyByName(rProp))
                return;
            try
            {
                xProps->setPropertyValue(rProp, rValue);
            }
            catch (const css::uno::Exception&)
            {
                SAL_WARN("sd.filter", "PDF widget import: could not set " << rProp);
            }
        };
        if (!aName.isEmpty())
            setProp(u"Name"_ustr, cpo::uno::Any(aName));
        // A flat frame only where the widget itself drew a border: a forced
        // frame put boxes on every field of forms whose fields sit on printed
        // rules or shaded bands.
        setProp(u"Border"_ustr,
                cpo::uno::Any(sal_Int16(pAnnot->getBorderWidth() > 0.0f ? 2 : 0)));
        if (nFieldFlags & nFieldReadOnly)
            setProp(u"ReadOnly"_ustr, cpo::uno::Any(true));
        const OUString aTooltip = pAnnot->getFormFieldAlternateName(mpPdfDocument.get());
        if (!aTooltip.isEmpty())
            setProp(u"HelpText"_ustr, cpo::uno::Any(aTooltip));
        switch (eKind)
        {
            case SdrObjKind::FormEdit:
            {
                setProp(u"MultiLine"_ustr, cpo::uno::Any((nFieldFlags & nFieldTextMultiLine) != 0));
                if (nFieldFlags & nFieldTextPassword)
                    setProp(u"EchoChar"_ustr, cpo::uno::Any(sal_Int16('*')));
                float fMaxLen = 0.0f;
                if (pAnnot->getNumberValue("MaxLen"_ostr, fMaxLen) && fMaxLen >= 1.0f
                    && fMaxLen <= static_cast<float>(SAL_MAX_INT16))
                    setProp(u"MaxTextLen"_ustr, cpo::uno::Any(static_cast<sal_Int16>(fMaxLen)));
                setProp(u"Text"_ustr, cpo::uno::Any(aValue));
                setProp(u"DefaultText"_ustr, cpo::uno::Any(aValue));
                break;
            }
            case SdrObjKind::FormCheckbox:
            case SdrObjKind::FormRadioButton:
            {
                // The radios of one field share its name: GroupName makes them
                // one group, which the export writes back as one radio field.
                if (eKind == SdrObjKind::FormRadioButton && !aName.isEmpty())
                    setProp(u"GroupName"_ustr, cpo::uno::Any(aName));
                // The widget's own "on" state name is its export value.
                const OUString aOnValue = pAnnot->getFormFieldExportValue(mpPdfDocument.get());
                if (!aOnValue.isEmpty())
                    setProp(u"RefValue"_ustr, cpo::uno::Any(aOnValue));
                const sal_Int16 nState = pAnnot->isChecked(mpPdfDocument.get()) ? 1 : 0;
                setProp(u"Label"_ustr, cpo::uno::Any(OUString()));
                setProp(u"State"_ustr, cpo::uno::Any(nState));
                setProp(u"DefaultState"_ustr, cpo::uno::Any(nState));
                break;
            }
            case SdrObjKind::FormCombobox:
            case SdrObjKind::FormListbox:
            {
                const int nOptions
                    = std::clamp(pAnnot->getOptionCount(mpPdfDocument.get()), 0, 10000);
                std::vector<OUString> aItems;
                std::vector<sal_Int16> aSelected;
                for (int nOption = 0; nOption < nOptions; ++nOption)
                {
                    aItems.push_back(pAnnot->getOptionLabel(mpPdfDocument.get(), nOption));
                    if (nOption <= SAL_MAX_INT16
                        && pAnnot->isOptionSelected(mpPdfDocument.get(), nOption))
                        aSelected.push_back(static_cast<sal_Int16>(nOption));
                }
                // The entries first: a selection is validated against them.
                setProp(u"StringItemList"_ustr,
                        cpo::uno::Any(cpo::uno::Sequence<OUString>(
                            aItems.data(), static_cast<sal_Int32>(aItems.size()))));
                if (eKind == SdrObjKind::FormCombobox)
                {
                    // /V holds an option's EXPORT value where options are
                    // [export, display] pairs (a "0" behind "Instructions in
                    // English"): show the selected option's label.
                    const OUString aShown
                        = aSelected.size() == 1 && aSelected.front() < nOptions
                              ? aItems[aSelected.front()]
                              : aValue;
                    setProp(u"Dropdown"_ustr, cpo::uno::Any(true));
                    setProp(u"Text"_ustr, cpo::uno::Any(aShown));
                    setProp(u"DefaultText"_ustr, cpo::uno::Any(aShown));
                }
                else
                {
                    const cpo::uno::Sequence<sal_Int16> aSelection(
                        aSelected.data(), static_cast<sal_Int32>(aSelected.size()));
                    setProp(u"MultiSelection"_ustr,
                            cpo::uno::Any((nFieldFlags & nFieldChoiceMultiSelect) != 0));
                    setProp(u"Dropdown"_ustr, cpo::uno::Any(false));
                    setProp(u"SelectedItems"_ustr, cpo::uno::Any(aSelection));
                    setProp(u"DefaultSelection"_ustr, cpo::uno::Any(aSelection));
                }
                break;
            }
            case SdrObjKind::FormButton:
                // A button's caption lives in its appearance (/MK /CA), which
                // pdfium does not expose; the tooltip names it instead.
                break;
            default:
                break;
        }
        InsertObj(pObj.get(), false);
    }
}

void ImpSdrPdfImport::SetupPageScale(const double dPageWidth, const double dPageHeight)
{
    mfScaleX = mfScaleY = 1.0;

    // Store the page dimensions in Points.
    mdPageHeightPts = dPageHeight;

    Size aPageSize(convertPointToMm100(dPageWidth), convertPointToMm100(dPageHeight));
    Size aScaleRectSize = maScaleRect.GetSize();

    if (aPageSize.Width() && aPageSize.Height() && (!maScaleRect.IsEmpty()))
    {
        maOfs = maScaleRect.TopLeft();

        if (aPageSize.Width() != aScaleRectSize.Width())
        {
            mfScaleX = static_cast<double>(aScaleRectSize.Width())
                       / static_cast<double>(aPageSize.Width());
        }

        if (aPageSize.Height() != aScaleRectSize.Height())
        {
            mfScaleY = static_cast<double>(aScaleRectSize.Height())
                       / static_cast<double>(aPageSize.Height());
        }
    }

    mbMov = maOfs.X() != 0 || maOfs.Y() != 0;
    mbSize = false;
    maScaleX = 1.0;
    maScaleY = 1.0;

    if (aPageSize.Width() != aScaleRectSize.Width())
    {
        maScaleX = double(aScaleRectSize.Width()) / aPageSize.Width();
        mbSize = true;
    }

    if (aPageSize.Height() != aScaleRectSize.Height())
    {
        maScaleY = double(aScaleRectSize.Height()) / aPageSize.Height();
        mbSize = true;
    }
}

size_t ImpSdrPdfImport::DoImport(SdrObjList& rOL, size_t nInsPos, int nPageNumber,
                                 SvdProgressInfo* pProgrInfo)
{
    sal_uInt32 nActionsToReport(0);

    // execute
    DoObjects(pProgrInfo, &nActionsToReport, nPageNumber);

    if (pProgrInfo)
    {
        pProgrInfo->ReportActions(nActionsToReport);
        nActionsToReport = 0;
    }

    // MapMode scaling
    MapScaling();

    // To calculate the progress meter, we use GetActionSize()*3.
    // However, maTmpList has a lower entry count limit than GetActionSize(),
    // so the actions that were assumed were too much have to be re-added.
    // nActionsToReport = (rMtf.GetActionSize() - maTmpList.size()) * 2;

    // announce all currently unannounced rescales
    if (pProgrInfo)
    {
        pProgrInfo->ReportRescales(nActionsToReport);
        pProgrInfo->SetInsertCount(maTmpList.size());
    }

    nActionsToReport = 0;

    // insert all objects cached in aTmpList now into rOL from nInsPos
    nInsPos = std::min(nInsPos, rOL.GetObjCount());

    for (rtl::Reference<SdrObject>& pObj : maTmpList)
    {
        rOL.NbcInsertObject(pObj.get(), nInsPos);
        nInsPos++;

        if (pProgrInfo)
        {
            nActionsToReport++;

            if (nActionsToReport >= 32) // update all 32 actions
            {
                pProgrInfo->ReportInserts(nActionsToReport);
                nActionsToReport = 0;
            }
        }
    }

    // report all remaining inserts for the last time
    if (pProgrInfo)
    {
        pProgrInfo->ReportInserts(nActionsToReport);
    }

    return maTmpList.size();
}

void ImpSdrPdfImport::SetAttributes(SdrObject* pObj, bool bForceTextAttr)
{
    mbNoLine = false;
    mbNoFill = false;
    bool bLine(!bForceTextAttr);
    bool bFill(!pObj || (pObj->IsClosedObj() && !bForceTextAttr));
    bool bText(bForceTextAttr || (pObj && pObj->GetOutlinerParaObject()));

    if (bLine)
    {
        if (mnLineWidth)
        {
            mpLineAttr->Put(XLineWidthItem(mnLineWidth));
        }
        else
        {
            mpLineAttr->Put(XLineWidthItem(0));
        }

        if (mpVD->IsLineColor())
        {
            mpLineAttr->Put(XLineStyleItem(drawing::LineStyle_SOLID)); //TODO support dashed lines.
            mpLineAttr->Put(XLineColorItem(OUString(), mpVD->GetLineColor()));
        }
        else
        {
            mpLineAttr->Put(XLineStyleItem(drawing::LineStyle_NONE));
        }

        mpLineAttr->Put(XLineJointItem(css::drawing::LineJoint_NONE));

        // Add LineCap support
        mpLineAttr->Put(XLineCapItem(gaLineCap));

        if (((maDash.GetDots() && maDash.GetDotLen())
             || (maDash.GetDashes() && maDash.GetDashLen()))
            && maDash.GetDistance())
        {
            mpLineAttr->Put(XLineDashItem(OUString(), maDash));
        }
        else
        {
            mpLineAttr->Put(XLineDashItem(OUString(), XDash(css::drawing::DashStyle_RECT)));
        }
    }
    else
    {
        mbNoLine = true;
    }

    if (bFill)
    {
        bool doFill
            = mpVD->GetDrawMode() != DrawModeFlags::NoFill && (moFillColor || moFillPattern);
        if (doFill && moFillColor)
            doFill = !moFillColor->IsTransparent();
        if (doFill)
        {
            if (moFillColor)
            {
                mpFillAttr->Put(XFillStyleItem(drawing::FillStyle_SOLID));
                mpFillAttr->Put(XFillColorItem(OUString(), *moFillColor));
            }
            else
            {
                assert(moFillPattern && "pattern should exist");
                mpFillAttr->Put(XFillStyleItem(drawing::FillStyle_BITMAP));
                mpFillAttr->Put(XFillBitmapItem(OUString(), Graphic(*moFillPattern)));
                mpFillAttr->Put(XFillBmpStretchItem(false));
                mpFillAttr->Put(XFillBmpTileItem(true));
                mpFillAttr->Put(
                    XFillBmpSizeXItem(convertPointToMm100(moFillPattern->GetSizePixel().Width())));
                mpFillAttr->Put(
                    XFillBmpSizeYItem(convertPointToMm100(moFillPattern->GetSizePixel().Height())));
            }
        }
        else
        {
            mpFillAttr->Put(XFillStyleItem(drawing::FillStyle_NONE));
        }
    }
    else
    {
        mbNoFill = true;
    }

    if (bText && mbFntDirty)
    {
        vcl::Font aFnt(mpVD->GetFont());
        const sal_uInt32 nHeight(
            basegfx::fround<sal_uInt32>(aFnt.GetFontSize().Height() * mfScaleY));

        mpTextAttr->Put(SvxFontItem(aFnt.GetFamilyType(), aFnt.GetFamilyName(), aFnt.GetStyleName(),
                                    aFnt.GetPitchMaybeAskConfig(), aFnt.GetCharSet(),
                                    EE_CHAR_FONTINFO));
        mpTextAttr->Put(SvxFontItem(aFnt.GetFamilyType(), aFnt.GetFamilyName(), aFnt.GetStyleName(),
                                    aFnt.GetPitchMaybeAskConfig(), aFnt.GetCharSet(),
                                    EE_CHAR_FONTINFO_CJK));
        mpTextAttr->Put(SvxFontItem(aFnt.GetFamilyType(), aFnt.GetFamilyName(), aFnt.GetStyleName(),
                                    aFnt.GetPitchMaybeAskConfig(), aFnt.GetCharSet(),
                                    EE_CHAR_FONTINFO_CTL));
        mpTextAttr->Put(SvxPostureItem(aFnt.GetItalicMaybeAskConfig(), EE_CHAR_ITALIC));
        mpTextAttr->Put(SvxWeightItem(aFnt.GetWeightMaybeAskConfig(), EE_CHAR_WEIGHT));
        mpTextAttr->Put(SvxFontHeightItem(nHeight, 100, EE_CHAR_FONTHEIGHT));
        mpTextAttr->Put(SvxFontHeightItem(nHeight, 100, EE_CHAR_FONTHEIGHT_CJK));
        mpTextAttr->Put(SvxFontHeightItem(nHeight, 100, EE_CHAR_FONTHEIGHT_CTL));
        mpTextAttr->Put(SvxCharScaleWidthItem(100, EE_CHAR_FONTWIDTH));
        mpTextAttr->Put(SvxUnderlineItem(aFnt.GetUnderline(), EE_CHAR_UNDERLINE));
        mpTextAttr->Put(SvxOverlineItem(aFnt.GetOverline(), EE_CHAR_OVERLINE));
        mpTextAttr->Put(SvxCrossedOutItem(aFnt.GetStrikeout(), EE_CHAR_STRIKEOUT));
        mpTextAttr->Put(SvxShadowedItem(aFnt.IsShadow(), EE_CHAR_SHADOW));

        // #i118485# Setting this item leads to problems (written #i118498# for this)
        // mpTextAttr->Put(SvxAutoKernItem(aFnt.IsKerning(), EE_CHAR_KERNING));

        mpTextAttr->Put(SvxWordLineModeItem(aFnt.IsWordLineMode(), EE_CHAR_WLM));
        mpTextAttr->Put(SvxContourItem(aFnt.IsOutline(), EE_CHAR_OUTLINE));
        mpTextAttr->Put(SvxColorItem(mpVD->GetTextColor(), EE_CHAR_COLOR));
        //... svxfont textitem svditext
        mbFntDirty = false;
    }

    if (!pObj)
        return;

    pObj->SetLayer(mnLayer);

    if (bLine)
    {
        pObj->SetMergedItemSet(*mpLineAttr);
    }

    if (bFill)
    {
        pObj->SetMergedItemSet(*mpFillAttr);
    }

    if (bText)
    {
        pObj->SetMergedItemSet(*mpTextAttr);
        pObj->SetMergedItem(SdrTextHorzAdjustItem(SDRTEXTHORZADJUST_LEFT));
    }
}

void ImpSdrPdfImport::InsertObj(SdrObject* pObj1, bool bScale)
{
    rtl::Reference<SdrObject> pObj = pObj1;
    if (bScale && !maScaleRect.IsEmpty())
    {
        if (mbSize)
        {
            pObj->NbcResize(Point(), maScaleX, maScaleY);
        }

        if (mbMov)
        {
            pObj->NbcMove(Size(maOfs.X(), maOfs.Y()));
        }
    }

    if (!pObj)
        return;

    // #i111954# check object for visibility
    // used are SdrPathObj, SdrRectObj, SdrCircObj, SdrGrafObj
    bool bVisible(false);

    if (pObj->HasLineStyle())
    {
        bVisible = true;
    }

    if (!bVisible && pObj->HasFillStyle())
    {
        bVisible = true;
    }

    if (!bVisible)
    {
        SdrTextObj* pTextObj = DynCastSdrTextObj(pObj.get());

        if (pTextObj && pTextObj->HasText())
        {
            bVisible = true;
        }
    }

    if (!bVisible)
    {
        SdrGrafObj* pGrafObj = dynamic_cast<SdrGrafObj*>(pObj.get());

        if (pGrafObj)
        {
            // this may be refined to check if the graphic really is visible. It
            // is here to ensure that graphic objects without fill, line and text
            // get created
            bVisible = true;
        }
    }

    if (bVisible)
    {
        maTmpList.push_back(pObj);

        if (dynamic_cast<SdrPathObj*>(pObj.get()))
        {
            const bool bClosed(pObj->IsClosedObj());

            mbLastObjWasPolyWithoutLine = mbNoLine && bClosed;
        }
        else
        {
            mbLastObjWasPolyWithoutLine = false;
        }
    }
}

bool ImpSdrPdfImport::CheckLastPolyLineAndFillMerge(const basegfx::B2DPolyPolygon& rPolyPolygon)
{
    // #i73407# reformulation to use new B2DPolygon classes
    if (mbLastObjWasPolyWithoutLine)
    {
        SdrObject* pTmpObj = !maTmpList.empty() ? maTmpList[maTmpList.size() - 1].get() : nullptr;
        SdrPathObj* pLastPoly = dynamic_cast<SdrPathObj*>(pTmpObj);

        if (pLastPoly)
        {
            if (pLastPoly->GetPathPoly() == rPolyPolygon)
            {
                SetAttributes(nullptr);

                if (!mbNoLine && mbNoFill)
                {
                    pLastPoly->SetMergedItemSet(*mpLineAttr);

                    return true;
                }
            }
        }
    }

    return false;
}

void ImpSdrPdfImport::ImportPdfObject(
    std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
    std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage,
    std::unique_ptr<vcl::pdf::PDFiumTextPage> const& pTextPage, int nPageObjectIndex)
{
    if (!pPageObject)
        return;

    const vcl::pdf::PDFPageObjectType ePageObjectType = pPageObject->getType();
    switch (ePageObjectType)
    {
        case vcl::pdf::PDFPageObjectType::Text:
            ImportText(pPageObject, pPage, pTextPage, nPageObjectIndex);
            break;
        case vcl::pdf::PDFPageObjectType::Path:
            ImportPath(pPageObject, pPage, nPageObjectIndex);
            break;
        case vcl::pdf::PDFPageObjectType::Image:
            ImportImage(pPageObject, pPage, nPageObjectIndex);
            break;
        case vcl::pdf::PDFPageObjectType::Shading:
            SAL_WARN("sd.filter", "Got page object SHADING: " << nPageObjectIndex);
            break;
        case vcl::pdf::PDFPageObjectType::Form:
            ImportForm(pPageObject, pPage, pTextPage, nPageObjectIndex);
            break;
        default:
            SAL_WARN("sd.filter", "Unknown PDF page object #" << nPageObjectIndex << " of type: "
                                                              << static_cast<int>(ePageObjectType));
            break;
    }
}

void ImpSdrPdfImport::ImportForm(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                                 std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage,
                                 std::unique_ptr<vcl::pdf::PDFiumTextPage> const& pTextPage,
                                 int /*nPageObjectIndex*/)
{
    // Get the form matrix to perform correct translation/scaling of the form sub-objects.
    const basegfx::B2DHomMatrix aOldMatrix = maCurrentMatrix;

    maCurrentMatrix = pPageObject->getMatrix();

    const int nCount = pPageObject->getFormObjectCount();
    for (int nIndex = 0; nIndex < nCount; ++nIndex)
    {
        auto pFormObject = pPageObject->getFormObject(nIndex);

        ImportPdfObject(pFormObject, pPage, pTextPage, -1);
    }

    // Restore the old one.
    maCurrentMatrix = aOldMatrix;
}

static bool extractEntry(std::string_view line, std::string_view key, OString& ret)
{
    std::string_view result;
    if (o3tl::starts_with(line, key, &result))
    {
        result = o3tl::trim(result);
        if (result[0] == '"' && result[result.size() - 1] == '"')
            result = result.substr(1, result.size() - 2);
        ret = OString(result);
        return true;
    }
    return false;
}

static bool isSimpleFamilyName(std::string_view Weight)
{
    return Weight.empty() || Weight == "Regular" || Weight == "Italic" || Weight == "Bold"
           || Weight == "BoldItalic";
}

// a) change brokenName/brokenCIDName if present to fixedName
// b) remove preamble FontMatrix and overwrite following ones in the %ADOBeginFontDict
// section with that content instead to avoid generating fonts with unusual UnitsPerEm
// of 1 that freetype will reject
static void rewriteFont(std::string_view brokenName, std::string_view brokenCIDName,
                        std::string_view fixedName, const OUString& pfaCIDUrl)
{
    OUString oldCIDUrl = pfaCIDUrl + ".broken";
    if (osl::File::move(pfaCIDUrl, oldCIDUrl) != osl::File::E_None)
    {
        SAL_WARN("sd.filter", "unable to move file");
        return;
    }

    const bool rewriteNames = !brokenName.empty();

    bool fontDict = false;

    OString sGlobalMatrix;

    const OString sBrokenFontLine = "/FontName /"_ostr + brokenName + " def"_ostr;
    const OString sFixedFontLine = "/FontName /"_ostr + fixedName + " def"_ostr;

    const OString sBrokenCIDFontLine = "/CIDFontName /"_ostr + brokenCIDName + " def"_ostr;
    const OString sFixedCIDFontLine = "/CIDFontName /"_ostr + fixedName + " def"_ostr;

    SvFileStream input(oldCIDUrl, StreamMode::READ);
    SvFileStream output(pfaCIDUrl, StreamMode::WRITE | StreamMode::TRUNC);
    OString sLine;
    while (input.ReadLine(sLine))
    {
        if (rewriteNames)
        {
            if (sLine == sBrokenFontLine)
            {
                output.WriteLine(sFixedFontLine);
                continue;
            }
            else if (sLine == sBrokenCIDFontLine)
            {
                output.WriteLine(sFixedCIDFontLine);
                continue;
            }
        }

        if (sLine.startsWith("%ADOBeginFontDict"))
            fontDict = true;
        else if (sLine.startsWith("/FontMatrix "))
        {
            if (!fontDict)
            {
                // Global case, stash and don't emit the global matrix
                sGlobalMatrix = sLine;
                continue;
            }

            if (!sGlobalMatrix.isEmpty())
            {
                // Local case, emit the global matrix instead if
                // there was one, otherwise emit the local matrix
                output.WriteLine(sGlobalMatrix);
                continue;
            }
        }

        output.WriteLine(sLine);
        if (sLine.startsWith("%%BeginData"))
        {
            // Write the rest direct as-is and quit
            output.WriteStream(input);
            break;
        }
    }
}

// https://ccjktype.fonts.adobe.com/2011/12/leveraging-afdko-part-1.html
// https://ccjktype.fonts.adobe.com/2012/01/leveraging-afdko-part-2.html
// https://ccjktype.fonts.adobe.com/2012/01/leveraging-afdko-part-3.html
static bool toPfaCID(SubSetInfo& rSubSetInfo, const OUString& fileUrl,
                     const OUString& postScriptName, bool& bNameKeyed,
                     std::map<int, int>& nameIndexToGlyph, OString& FontName, OString& Weight,
                     OString& FSType)
{
    bNameKeyed = false;
    FSType = "0"_ostr;

    OUString infoUrl = fileUrl + u".1";
    OUString cidFontInfoUrl = fileUrl + u".cidfontinfo";
    OUString nameToCIDMapUrl = fileUrl + u".nametocidmap";
    OUString toMergedMapUrl = fileUrl + u".tomergedmap";

    OString version, Notice, FullName, FamilyName, CIDFontName, CIDFontVersion, srcFontType,
        glyphTag, FontMatrix;
    OString brokenFontName;
    FontName = postScriptName.toUtf8();
    std::map<sal_Int32, OString> glyphIndexToName;

    OUString pfaUrl, pfaCIDUrl;

    rSubSetInfo.aComponents.back().cidFontInfoUrl = cidFontInfoUrl;
    rSubSetInfo.aComponents.back().toMergedMapUrl = toMergedMapUrl;

    pfaUrl = fileUrl + u".pfa";
    pfaCIDUrl = pfaUrl + u".cid";

    rSubSetInfo.aComponents.back().pfaCIDUrl = pfaCIDUrl;

    if (!EmbeddedFontsManager::tx_dump(fileUrl, infoUrl))
    {
        SAL_WARN("sd.filter", "font file info extraction failed");
        return false;
    }
    SAL_INFO("sd.filter", "dump success");
    SvFileStream info(infoUrl, StreamMode::READ);
    OStringBuffer glyphBuffer;
    OString sLine;
    while (info.ReadLine(sLine))
    {
        if (extractEntry(sLine, "version", version))
            continue;
        if (extractEntry(sLine, "cid.CIDFontVersion", CIDFontVersion))
            continue;
        if (extractEntry(sLine, "Notice", Notice))
            continue;
        if (extractEntry(sLine, "FullName", FullName))
            continue;
        if (extractEntry(sLine, "FamilyName", FamilyName))
            continue;
        if (extractEntry(sLine, "FSType", FSType))
            continue;
        if (extractEntry(sLine, "Weight", Weight))
            continue;
        if (extractEntry(sLine, "FontMatrix", FontMatrix))
            continue;
        if (extractEntry(sLine, "sup.srcFontType", srcFontType))
            continue;
        if (extractEntry(sLine, "## glyph[tag]", glyphTag))
            continue;
        if (extractEntry(sLine, "FontName", FontName))
        {
            const bool bBrokenFontName = FontName != postScriptName.toUtf8();
            if (bBrokenFontName)
            {
                SAL_WARN("sd.filter", "expected that FontName of <"
                                          << FontName << "> matches PostScriptName of <"
                                          << postScriptName << ">");
                brokenFontName = FontName;
            }
            continue;
        }
        if (extractEntry(sLine, "cid.CIDFontName", CIDFontName))
        {
            SAL_WARN_IF(CIDFontName != postScriptName.toUtf8(), "sd.filter",
                        "expected that cid.CIDFontName of <"
                            << CIDFontName << "> matches PostScriptName of <" << postScriptName
                            << ">");
            continue;
        }
        if (sLine.startsWith("glyph["))
        {
            sal_Int32 i = 6;
            while (i < sLine.getLength())
            {
                ++i;
                if (sLine[i - 1] == ']')
                    break;
                glyphBuffer.append(sLine[i - 1]);
            }
            sal_Int32 nGlyphIndex = glyphBuffer.makeStringAndClear().toInt32();
            while (i < sLine.getLength())
            {
                ++i;
                if (sLine[i - 1] == '{')
                    break;
            }
            while (i < sLine.getLength())
            {
                ++i;
                if (sLine[i - 1] == ',')
                    break;
                glyphBuffer.append(sLine[i - 1]);
            }
            SAL_INFO("sd.filter",
                     "setting index: " << nGlyphIndex << " as: " << glyphBuffer.toString());
            glyphIndexToName[nGlyphIndex] = glyphBuffer.makeStringAndClear();
            while (i < sLine.getLength())
            {
                ++i;
                if (sLine[i - 1] == '}')
                    break;
                glyphBuffer.append(sLine[i - 1]);
            }
            SAL_INFO("sd.filter", "code text: " << glyphBuffer.toString());
            OString sCode = glyphBuffer.makeStringAndClear();
            sal_Int32 nCodePoint
                = sCode.startsWith("0x") ? o3tl::toInt32(sCode.subView(2), 16) : sCode.toInt32();
            SAL_INFO("sd.filter", "codepoint is: " << nCodePoint);
            nameIndexToGlyph[nCodePoint] = nGlyphIndex;
        }
    }
    SAL_INFO("sd.filter", "details are: " << version << Notice << FullName << FamilyName << Weight
                                          << srcFontType << FontName << CIDFontName
                                          << CIDFontVersion);

    if (version.isEmpty())
        version = CIDFontVersion;

    if (version.isEmpty() || version.toDouble() == 0.0)
    {
        SAL_WARN("sd.filter", "Font version cannot be empty or 0.0");
        version = "0.001"_ostr;
    }

    if (!brokenFontName.isEmpty())
        FontName = postScriptName.toUtf8();

    // Always create cidFontInfo, we will need it if we need to merge fonts
    OString AdobeCopyright, Trademark;
    sal_Int32 nSplit = !Notice.isEmpty() ? Notice.lastIndexOf('.', Notice.getLength() - 1) : -1;
    if (nSplit != -1)
    {
        AdobeCopyright = Notice.copy(0, nSplit + 1);
        Trademark = Notice.copy(nSplit + 1);
    }
    else
        AdobeCopyright = Notice;
    SvFileStream cidFontInfo(cidFontInfoUrl, StreamMode::READWRITE | StreamMode::TRUNC);
    cidFontInfo.WriteLine(Concat2View("FontName\t(" + FontName + ")"));
    cidFontInfo.WriteLine(Concat2View("FullName\t(" + FullName + ")"));
    OString OutputFamilyName = FamilyName;
    if (!isSimpleFamilyName(Weight))
        OutputFamilyName = OutputFamilyName + " " + Weight;
    cidFontInfo.WriteLine(Concat2View("FamilyName\t(" + OutputFamilyName + ")"));
    cidFontInfo.WriteLine(Concat2View("version\t\t(" + version + ")"));
    cidFontInfo.WriteLine("Registry\t(Adobe)");
    cidFontInfo.WriteLine("Ordering\t(Identity)");
    cidFontInfo.WriteLine("Supplement\t0");
    cidFontInfo.WriteLine("XUID\t\t[1 11 9273828]");
    cidFontInfo.WriteLine(Concat2View("FSType\t\t" + FSType));
    cidFontInfo.WriteLine(Concat2View("AdobeCopyright\t(" + AdobeCopyright + ")"));
    cidFontInfo.WriteLine(Concat2View("Trademark\t(" + Trademark + ")"));
    cidFontInfo.Close();

    /*
      ## glyph[tag] {cid,iFD}
      or
      ## glyph[tag] {name,encoding}
    */
    bNameKeyed = glyphTag == "{name,encoding}";
    if (bNameKeyed)
    {
        SAL_INFO("sd.filter", "convert to cid keyed");
        SvFileStream nameToCIDMap(nameToCIDMapUrl, StreamMode::READWRITE | StreamMode::TRUNC);
        nameToCIDMap.WriteLine(Concat2View("mergefonts " + FontName + " 0"));
        for (const auto& glyph : glyphIndexToName)
        {
            SAL_INFO("sd.filter", "writing index: " << glyph.first << " as: " << glyph.second);
            nameToCIDMap.WriteLine(Concat2View(OString::number(glyph.first) + "\t" + glyph.second));
        }
        nameToCIDMap.Close();

        if (!EmbeddedFontsManager::tx_t1(fileUrl, pfaUrl))
        {
            SAL_WARN("sd.filter", "pfa conversion failed");
            return false;
        }

        std::vector<std::pair<OUString, OUString>> fonts;
        fonts.push_back(std::make_pair(nameToCIDMapUrl, pfaUrl));
        if (!EmbeddedFontsManager::mergefonts(cidFontInfoUrl, pfaCIDUrl, fonts))
        {
            SAL_WARN("sd.filter", "conversion 2 failed");
            return false;
        }
    }
    else
    {
        if (!EmbeddedFontsManager::tx_t1(fileUrl, pfaCIDUrl))
        {
            SAL_WARN("sd.filter", "pfa conversion failed");
            return false;
        }
    }

    if (!brokenFontName.isEmpty() || !FontMatrix.isEmpty())
    {
        // If the fontname isn't as expected, or if there is a
        // font matrix present then we rewrite the font.
        rewriteFont(brokenFontName, CIDFontName, FontName, pfaCIDUrl);
    }

    return true;
}

static void appendFourByteHex(OStringBuffer& rBuffer, sal_uInt32 nNumber)
{
    OString sCodePoint = OString::number(nNumber, 16);
    for (sal_Int32 j = sCodePoint.getLength(); j < 4; ++j)
        rBuffer.append('0');
    rBuffer.append(sCodePoint);
}

static OString decomposeLegacyUnicodeLigature(UChar32 cUnicode)
{
    UErrorCode eCode(U_ZERO_ERROR);

    // Put in any legacy unicode ligature decompositions, which we detect as U_DT_COMPAT and
    // a multi-character decomposition.
    UDecompositionType decompType = static_cast<UDecompositionType>(
        u_getIntPropertyValue(cUnicode, UCHAR_DECOMPOSITION_TYPE));
    if (decompType == UDecompositionType::U_DT_COMPAT)
    {
        const icu::Normalizer2* pInstance = icu::Normalizer2::getNFKDInstance(eCode);

        if (pInstance && eCode == U_ZERO_ERROR)
        {
            icu::UnicodeString sDecomposed;
            pInstance->getRawDecomposition(cUnicode, sDecomposed);
            if (sDecomposed.length() > 1)
            {
                OStringBuffer aBuffer;
                for (int32_t i = 0, nLen = sDecomposed.length(); i < nLen; ++i)
                    appendFourByteHex(aBuffer, sDecomposed[i]);
                return aBuffer.makeStringAndClear();
            }
        }
    }

    return OString();
}

const char cmapprefix[] = "%!PS-Adobe-3.0 Resource-CMap\n"
                          "/WMode 0 def\n"
                          "\n"
                          "/CIDInit /ProcSet findresource begin\n"
                          "12 dict begin\n"
                          "begincmap\n"
                          "/CIDSystemInfo\n"
                          "<< /Registry (Adobe)\n"
                          "   /Ordering (UCS)\n"
                          "   /Supplement 0\n"
                          ">> def\n"
                          "/CMapName /Adobe-Identity-UCS def\n"
                          "/CMapType 2 def\n"
                          "1 begincodespacerange\n"
                          "<0000> <ffff>\n"
                          "endcodespacerange\n";

const char cmapsuffix[] = "endcmap\n"
                          "CMapName currentdict /CMap defineresource pop\n"
                          "end\n"
                          "end\n";

namespace
{
struct ToUnicodeData
{
    std::vector<OString> bfcharlines;
    std::vector<OString> bfcharranges;

    // one or the other of these
    const vcl::pdf::PDFiumFont* pFont;
    const std::map<int, int>* pNameIndexToGlyph;

    // For the pdf provided mapping from the font to unicode
    ToUnicodeData(const std::vector<uint8_t>& toUnicodeData, const vcl::pdf::PDFiumFont& pdfFont)
        : pFont(&pdfFont)
        , pNameIndexToGlyph(nullptr)
    {
        SvMemoryStream aInCMap(const_cast<uint8_t*>(toUnicodeData.data()), toUnicodeData.size(),
                               StreamMode::READ);

        OString sLine;
        while (aInCMap.ReadLine(sLine))
        {
            if (sLine.endsWith("beginbfchar"))
            {
                while (aInCMap.ReadLine(sLine))
                {
                    if (sLine.endsWith("endbfchar"))
                        break;
                    bfcharlines.push_back(sLine);
                }
            }
            else if (sLine.endsWith("beginbfrange"))
            {
                while (aInCMap.ReadLine(sLine))
                {
                    if (sLine.endsWith("endbfrange"))
                        break;
                    bfcharranges.push_back(sLine);
                }
            }
        }
    }

    // For name keyed fonts without toUnicode data where we
    // can assume the font encoding is Adobe Standard and
    // reverse map from the name indexes so we can forward
    // map to unicode
    ToUnicodeData(std::map<int, int>& nameIndexToGlyph)
        : pFont(nullptr)
        , pNameIndexToGlyph(&nameIndexToGlyph)
    {
        for (const auto & [ adobe, glyphid ] : nameIndexToGlyph)
        {
            if (glyphid == 0)
                continue;

            const char cChar(adobe);
            OUString sUni(&cChar, 1, RTL_TEXTENCODING_ADOBE_STANDARD);
            sal_Unicode mappedChar = sUni.toChar();

            OStringBuffer aBuffer("<");
            appendFourByteHex(aBuffer, adobe);
            aBuffer.append("> <");
            appendFourByteHex(aBuffer, mappedChar);
            aBuffer.append(">");
            bfcharlines.push_back(aBuffer.toString());
        }
    }

    sal_uInt32 getGlyphIndexFromCharCode(sal_uInt32 nPDFCharCode)
    {
        if (pFont)
            return pFont->getGlyphIndexFromCharCode(nPDFCharCode);
        assert(pNameIndexToGlyph);
        auto it = pNameIndexToGlyph->find(nPDFCharCode);
        return it != pNameIndexToGlyph->end() ? it->second : 0;
    }
};
}

static void buildCMapAndFeatures(const OUString& CMapUrl, SvFileStream& Features,
                                 std::string_view FontName, ToUnicodeData& tud,
                                 SubSetInfo& rSubSetInfo)
{
    SvFileStream CMap(CMapUrl, StreamMode::READWRITE | StreamMode::TRUNC);

    CMap.WriteBytes(cmapprefix, std::size(cmapprefix) - 1);

    sal_Int32 mergeOffset = 1; //Leave space for notdef
    for (const auto& count : rSubSetInfo.aComponents)
        mergeOffset += count.nGlyphCount;

    std::map<sal_Int32, OString> ligatureGlyphToChars;
    std::vector<sal_Int32> glyphs;

    if (!tud.bfcharranges.empty())
    {
        std::vector<OString> cidranges;

        for (const auto& charrange : tud.bfcharranges)
        {
            assert(charrange[0] == '<');
            sal_Int32 nEnd = charrange.indexOf('>', 1);
            assert(charrange[nEnd] == '>');
            sal_Int32 nGlyphRangeStart = o3tl::toInt32(charrange.subView(1, nEnd - 1), 16);

            OString remainder(o3tl::trim(charrange.subView(nEnd + 1)));
            assert(remainder[0] == '<');
            nEnd = remainder.indexOf('>', 1);
            assert(remainder[nEnd] == '>');
            sal_Int32 nGlyphRangeEnd = o3tl::toInt32(remainder.subView(1, nEnd - 1), 16);

            sal_Int32 nGlyphRangeLen = nGlyphRangeEnd - nGlyphRangeStart;

            assert(nGlyphRangeLen >= 0);

            OString sChars(o3tl::trim(remainder.subView(nEnd + 1)));
            assert(sChars[0] == '<' && sChars[sChars.getLength() - 1] == '>');

            // move simple single glyph->char ranges to bfcharlines instead
            if (nGlyphRangeLen == 0)
            {
                OStringBuffer aBuffer("<");
                appendFourByteHex(aBuffer, nGlyphRangeStart);
                aBuffer.append("> " + sChars);
                tud.bfcharlines.push_back(aBuffer.toString());
                continue;
            }

            OString sContents = sChars.copy(1, sChars.getLength() - 2);
            //The assumption that is that cases of ligatures are with a range
            //of a single glyph(?). In which case we have pushed such entries
            //into bfcharlines above.
            assert(sContents.getLength() == 4);
            sal_Int32 nCharRangeStart = o3tl::toInt32(sContents, 16);
            sal_Int32 nCharRangeEnd = nCharRangeStart + nGlyphRangeLen;

            // move simple single glyph->char ranges to bfcharlines instead
            if (nCharRangeStart == nCharRangeEnd)
            {
                OStringBuffer aBuffer("<");
                appendFourByteHex(aBuffer, nGlyphRangeStart);
                aBuffer.append("> <");
                appendFourByteHex(aBuffer, nCharRangeStart);
                aBuffer.append(">");
                tud.bfcharlines.push_back(aBuffer.toString());
                continue;
            }

            OStringBuffer aBuffer("<");
            appendFourByteHex(aBuffer, nCharRangeStart);
            aBuffer.append("> <");
            appendFourByteHex(aBuffer, nCharRangeEnd);
            aBuffer.append("> "_ostr + OString::number(nGlyphRangeStart));
            OString cidrangeline = aBuffer.toString();
            cidranges.push_back(cidrangeline);
            rSubSetInfo.aComponents.back().glyphRangesToChars[nGlyphRangeStart]
                = Range(nCharRangeStart, nCharRangeEnd);
        }

        if (!cidranges.empty())
        {
            // searching for real world examples where this occurs
            OString beginline = OString::number(cidranges.size()) + " begincidrange";
            CMap.WriteLine(beginline);
            for (const auto& rLine : cidranges)
                CMap.WriteLine(rLine);
            CMap.WriteLine("endcidrange");
        }
    }

    if (!tud.bfcharlines.empty())
    {
        std::set<OString> usedCodes;
        std::vector<OString> outputlines;
        for (const auto& charline : tud.bfcharlines)
        {
            assert(charline[0] == '<');
            sal_Int32 nEnd = charline.indexOf('>', 1);
            assert(charline[nEnd] == '>');
            sal_Int32 nPDFCharCode = o3tl::toInt32(charline.subView(1, nEnd - 1), 16);
            sal_Int32 nGlyphIndex = tud.getGlyphIndexFromCharCode(nPDFCharCode);
            OString sChars(o3tl::trim(charline.subView(nEnd + 1)));
            assert(sChars[0] == '<' && sChars[sChars.getLength() - 1] == '>');
            OString sContents = sChars.copy(1, sChars.getLength() - 2);
            assert(sContents.getLength() % 4 == 0);
            sal_Int32 nCharsPerCode = sContents.getLength() / 4;
            if (nCharsPerCode > 1)
                ligatureGlyphToChars[nGlyphIndex] = sContents;
            else
            {
                OString sLegacy
                    = decomposeLegacyUnicodeLigature(static_cast<UChar32>(sContents.toUInt32(16)));
                if (!sLegacy.isEmpty())
                    ligatureGlyphToChars[nGlyphIndex] = sLegacy;
            }
            if (usedCodes.insert(sChars).second == false)
            {
                // This can happen with e.g. unicode '1' mapped to from two variants of that glyph,
                // in the absence of a better idea, prefer the first one seen
                SAL_INFO("sd.filter", "code: " << sChars << " for glyph " << nGlyphIndex
                                               << " already used earlier");
                continue;
            }
            OString cidcharline = sChars + " " + OString::number(nGlyphIndex);
            glyphs.push_back(nGlyphIndex);
            rSubSetInfo.aComponents.back().glyphToChars[nGlyphIndex] = sContents;
            rSubSetInfo.aComponents.back().charsToGlyph[sContents] = nGlyphIndex;
            outputlines.push_back(cidcharline);
        }

        OString beginline = OString::number(outputlines.size()) + " begincidchar";
        CMap.WriteLine(beginline);
        for (const auto& cidcharline : outputlines)
            CMap.WriteLine(cidcharline);
        CMap.WriteLine("endcidchar");

        rSubSetInfo.aComponents.back().nGlyphCount = tud.bfcharlines.size();
    }

    CMap.WriteBytes(cmapsuffix, std::size(cmapsuffix) - 1);

    const OUString& toMergedMapUrl = rSubSetInfo.aComponents.back().toMergedMapUrl;
    SvFileStream toMergedMap(toMergedMapUrl, StreamMode::READWRITE | StreamMode::TRUNC);
    toMergedMap.WriteLine(Concat2View("mergefonts "_ostr + FontName + " 0"_ostr));
    if (rSubSetInfo.aComponents.size() == 1)
        toMergedMap.WriteLine("0\t0");
    for (size_t i = 0; i < glyphs.size(); ++i)
    {
        OString sMapLine = OString::number(i + mergeOffset) + "\t" + OString::number(glyphs[i]);
        toMergedMap.WriteLine(sMapLine);
    }
    toMergedMap.Close();

    CMap.Close();

    if (!ligatureGlyphToChars.empty())
    {
        std::map<OString, sal_Int32>& charsToGlyph = rSubSetInfo.aComponents.back().charsToGlyph;

        Features.WriteLine("languagesystem DFLT dflt;");
        Features.WriteLine("feature liga {");
        for (const auto& ligature : ligatureGlyphToChars)
        {
            sal_Int32 nLigatureGlyph = ligature.first;
            OString sLigatureChars = ligature.second;
            OStringBuffer ligatureLine("substitute");
            for (sal_Int32 i = 0; i < sLigatureChars.getLength(); i += 4)
            {
                OString sLigatureChar = sLigatureChars.copy(i, 4);
                sal_Int32 nCharGlyph = charsToGlyph[sLigatureChar];
                ligatureLine.append(" \\" + OString::number(nCharGlyph));
            }
            ligatureLine.append(" by \\" + OString::number(nLigatureGlyph) + ";");
            Features.WriteLine(ligatureLine);
        }
        Features.WriteLine("} liga;");
    }
}

static OUString buildFontMenuName(const OUString& FontMenuNameDBUrl,
                                  std::u16string_view postScriptName, const OUString& fontName,
                                  std::string_view Weight)
{
    OUString longFontName = fontName;

    // create FontMenuName
    SvFileStream FontMenuNameDB(FontMenuNameDBUrl, StreamMode::READWRITE | StreamMode::TRUNC,
                                RTL_TEXTENCODING_UTF8);
    OUString postScriptFontName = u"["_ustr + postScriptName + u"]"_ustr;
    FontMenuNameDB.WriteByteStringLine(postScriptFontName);
    SAL_INFO("sd.filter",
             "wrote basefont name: " << postScriptFontName << " to: " << FontMenuNameDBUrl);
    OUString setFontName = "f=" + fontName;
    FontMenuNameDB.WriteByteStringLine(setFontName);
    SAL_INFO("sd.filter", "wrote family name: " << setFontName << " to: " << FontMenuNameDBUrl);
    if (!isSimpleFamilyName(Weight))
    {
        longFontName = fontName + " " + OUString::createFromAscii(Weight);
        OUString setLongFontName = "l=" + fontName + " " + OUString::createFromAscii(Weight);
        FontMenuNameDB.WriteByteStringLine(setLongFontName);
        SAL_INFO("sd.filter",
                 "wrote long family name: " << setLongFontName << " to: " << FontMenuNameDBUrl);
        OUString styleName = "s=" + OUString::createFromAscii(Weight);
        FontMenuNameDB.WriteByteStringLine(styleName);
        SAL_INFO("sd.filter", "wrote style name: " << styleName << " to: " << FontMenuNameDBUrl);
    }
    FontMenuNameDB.Close();

    return longFontName;
}

// https://adobe-type-tools.github.io/font-tech-notes/pdfs/5900.RFMFAH_Tutorial.pdf
static EmbeddedFontInfo mergeFontSubsets(std::u16string_view prefix, const OUString& mergedFontUrl,
                                         const OUString& FontMenuNameDBUrl,
                                         const OUString& postScriptName,
                                         const OUString& longFontName, std::string_view Weight,
                                         const SubSetInfo& rSubSetInfo)
{
    SAL_INFO("sd.filter", "merging " << rSubSetInfo.aComponents.size() << " font subsets of "
                                     << postScriptName << " together to create: " << mergedFontUrl);
    std::vector<std::pair<OUString, OUString>> fonts;
    for (size_t i = 0; i < rSubSetInfo.aComponents.size(); ++i)
    {
        // Ignore subsets with no glyphs in them, except for the first one
        // which can have notdef in it
        if (i && !rSubSetInfo.aComponents[i].nGlyphCount)
            continue;
        fonts.push_back(std::make_pair(rSubSetInfo.aComponents[i].toMergedMapUrl,
                                       rSubSetInfo.aComponents[i].pfaCIDUrl));
    }
    if (!EmbeddedFontsManager::mergefonts(rSubSetInfo.aComponents[0].cidFontInfoUrl, mergedFontUrl,
                                          fonts))
    {
        SAL_WARN("sd.filter", "conversion failed");
        return EmbeddedFontInfo();
    }

    OUString mergedCMapUrl = mergedFontUrl + u".CMap";
    OUString mergedFeaturesUrl = mergedFontUrl + u".Features";

    SvFileStream mergedCMap(mergedCMapUrl, StreamMode::READWRITE | StreamMode::TRUNC);

    mergedCMap.WriteBytes(cmapprefix, std::size(cmapprefix) - 1);

    sal_Int32 cidcharcount(0), cidrangecount(0);
    bool differentcidranges(false);
    for (const auto& component : rSubSetInfo.aComponents)
        cidcharcount += component.glyphToChars.size();

    for (size_t i = 0, size = rSubSetInfo.aComponents.size(); i < size; ++i)
    {
        const auto& component = rSubSetInfo.aComponents[i];
        if (i == 0)
        {
            cidrangecount += component.glyphRangesToChars.size();
            continue;
        }

        if (component.glyphRangesToChars != rSubSetInfo.aComponents[i - 1].glyphRangesToChars)
        {
            cidrangecount += component.glyphRangesToChars.size();
            differentcidranges = true;
        }
    }

    assert(!differentcidranges && "TODO: deal with this when an example arises");
    if (differentcidranges)
        return EmbeddedFontInfo();

    std::map<sal_Int32, OString> ligatureGlyphToChars;
    std::map<OString, sal_Int32> charsToGlyph;

    if (cidrangecount)
    {
        OString beginline = OString::number(cidrangecount) + " begincidrange";
        mergedCMap.WriteLine(beginline);

        const auto& component = rSubSetInfo.aComponents[0];
        for (const auto& entry : component.glyphRangesToChars)
        {
            sal_Int32 glyphrangebegin = entry.first;
            sal_Int32 charrangebegin = entry.second.Min();
            sal_Int32 charrangeend = entry.second.Max();

            OStringBuffer aBuffer("<");
            appendFourByteHex(aBuffer, charrangebegin);
            aBuffer.append("> <");
            appendFourByteHex(aBuffer, charrangeend);
            aBuffer.append("> "_ostr + OString::number(glyphrangebegin));
            OString cidrangeline = aBuffer.toString();

            mergedCMap.WriteLine(cidrangeline);
        }

        // glyphoffset += component.nGlyphCount;
        mergedCMap.WriteLine("endcidrange");
    }

    if (cidcharcount)
    {
        sal_Int32 glyphoffset(0);
        OString beginline = OString::number(cidcharcount) + " begincidchar";
        mergedCMap.WriteLine(beginline);

        for (const auto& component : rSubSetInfo.aComponents)
        {
            for (const auto& entry : component.glyphToChars)
            {
                sal_Int32 glyph = entry.first + glyphoffset;
                OString sCharContents = entry.second;
                OString cidcharline = "<" + sCharContents + "> " + OString::number(glyph);

                sal_Int32 nCharsPerCode = sCharContents.getLength() / 4;
                if (nCharsPerCode > 1)
                    ligatureGlyphToChars[glyph] = sCharContents;
                else
                {
                    OString sLegacy = decomposeLegacyUnicodeLigature(
                        static_cast<UChar32>(sCharContents.toUInt32(16)));
                    if (!sLegacy.isEmpty())
                        ligatureGlyphToChars[glyph] = sLegacy;
                }

                charsToGlyph[entry.second] = glyph;
                mergedCMap.WriteLine(cidcharline);
            }
            glyphoffset += component.nGlyphCount;
        }
        mergedCMap.WriteLine("endcidchar");
    }

    mergedCMap.WriteBytes(cmapsuffix, std::size(cmapsuffix) - 1);

    mergedCMap.Close();

    if (!ligatureGlyphToChars.empty())
    {
        SvFileStream Features(mergedFeaturesUrl, StreamMode::READWRITE | StreamMode::TRUNC);
        Features.WriteLine("languagesystem DFLT dflt;");
        Features.WriteLine("feature liga {");
        for (const auto& ligature : ligatureGlyphToChars)
        {
            sal_Int32 nLigatureGlyph = ligature.first;
            OString sLigatureChars = ligature.second;
            OStringBuffer ligatureLine("substitute");
            for (sal_Int32 i = 0; i < sLigatureChars.getLength(); i += 4)
            {
                OString sLigatureChar = sLigatureChars.copy(i, 4);
                sal_Int32 nCharGlyph = charsToGlyph[sLigatureChar];
                ligatureLine.append(" \\" + OString::number(nCharGlyph));
            }
            ligatureLine.append(" by \\" + OString::number(nLigatureGlyph) + ";");
            Features.WriteLine(ligatureLine);
        }
        Features.WriteLine("} liga;");
        Features.Close();
    }

    OUString otfUrl = getFileUrlForTemporaryFont(prefix, postScriptName, u".otf");
    OUString features = !ligatureGlyphToChars.empty() ? mergedFeaturesUrl : OUString();
    if (EmbeddedFontsManager::makeotf(mergedFontUrl, otfUrl, FontMenuNameDBUrl, mergedCMapUrl,
                                      features))
        return { longFontName, otfUrl, toOfficeWeight(Weight) };
    SAL_WARN("sd.filter", "conversion failed");
    return EmbeddedFontInfo();
}

//static
EmbeddedFontInfo ImpSdrPdfImport::convertToOTF(std::u16string_view prefix, SubSetInfo& rSubSetInfo,
                                               const OUString& fileUrl, const OUString& fontName,
                                               const OUString& postScriptName,
                                               std::u16string_view fontFileName,
                                               const std::vector<uint8_t>& toUnicodeData,
                                               const vcl::pdf::PDFiumFont& font)
{
    // Convert to Type 1 CID keyed
    std::map<int, int> nameIndexToGlyph;
    bool bNameKeyed = false;
    OString FontName, Weight, FSType;
    if (!toPfaCID(rSubSetInfo, fileUrl, postScriptName, bNameKeyed, nameIndexToGlyph, FontName,
                  Weight, FSType))
    {
        return EmbeddedFontInfo();
    }

    OUString FeaturesUrl = fileUrl + u".Features";
    SvFileStream Features(FeaturesUrl, StreamMode::READWRITE | StreamMode::TRUNC);

    const OUString& pfaCIDUrl = rSubSetInfo.aComponents.back().pfaCIDUrl;

    // Build CMap from pdfium toUnicodeData, etc.
    OUString CMapUrl = fileUrl + u".CMap";
    bool bCMap = true;
    if (!toUnicodeData.empty())
    {
        ToUnicodeData tud(toUnicodeData, font);
        buildCMapAndFeatures(CMapUrl, Features, FontName, tud, rSubSetInfo);
    }
    else if (bNameKeyed)
    {
        SAL_INFO("sd.filter", "There is no CMap, assuming Adobe Standard encoding.");
        ToUnicodeData tud(nameIndexToGlyph);
        buildCMapAndFeatures(CMapUrl, Features, FontName, tud, rSubSetInfo);
    }
    else
    {
        SAL_WARN("sd.filter", "There is no CMap, pdfium is missing unicodedata");
        bCMap = false;
    }

    Features.WriteLine("table OS/2 {");
    Features.WriteLine(Concat2View("  FSType " + FSType + ";"));
    Features.WriteLine("} OS/2;");

    Features.Close();

    // Create FontMenuName
    OUString FontMenuNameDBUrl = fileUrl + u".FontMenuNameDBUrl";
    OUString longFontName = buildFontMenuName(FontMenuNameDBUrl, postScriptName, fontName, Weight);

    // Merge multiple font subsets together
    if (rSubSetInfo.aComponents.size() > 1)
    {
        OUString mergedFontUrl
            = getFileUrlForTemporaryFont(prefix, postScriptName, u".merged.pfa.cid");
        return mergeFontSubsets(prefix, mergedFontUrl, FontMenuNameDBUrl, postScriptName,
                                longFontName, Weight, rSubSetInfo);
    }

    // Otherwise not merged font, just a single subset
    OUString otfUrl = getFileUrlForTemporaryFont(prefix, fontFileName, u".otf");
    OUString cmap = bCMap ? CMapUrl : OUString();
    if (EmbeddedFontsManager::makeotf(pfaCIDUrl, otfUrl, FontMenuNameDBUrl, cmap, FeaturesUrl))
        return { longFontName, otfUrl, toOfficeWeight(Weight) };
    SAL_WARN("sd.filter", "conversion failed");
    return EmbeddedFontInfo();
}

// There isn't, as far as I know, a way to stroke with a pattern at the moment,
// so extract some sensible color if this is a stroke pattern
Color ImpSdrPdfImport::getStrokeColor(
    std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
    std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage)
{
    if (std::unique_ptr<vcl::pdf::PDFiumBitmap> bitmap
        = pPageObject->getRenderedStrokePattern(*mpPdfDocument, *pPage))
    {
        Bitmap aBitmap(bitmap->createBitmapFromBuffer());
        if (!aBitmap.IsEmpty())
            return aBitmap.GetPixelColor(aBitmap.GetSizePixel().Width() / 2,
                                         aBitmap.GetSizePixel().Height() / 2);
    }
    return pPageObject->getStrokeColor();
}

// Typically for a fill pattern you want to use some pattern fill equivalent
// but if that's not possible then this fallback can be useful
Color ImpSdrPdfImport::getFillColor(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                                    std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage)
{
    if (std::unique_ptr<vcl::pdf::PDFiumBitmap> bitmap
        = pPageObject->getRenderedFillPattern(*mpPdfDocument, *pPage))
    {
        Bitmap aBitmap(bitmap->createBitmapFromBuffer());
        if (!aBitmap.IsEmpty())
            return aBitmap.GetPixelColor(aBitmap.GetSizePixel().Width() / 2,
                                         aBitmap.GetSizePixel().Height() / 2);
    }
    return pPageObject->getFillColor();
}

static bool AllowDim(tools::Long nDim)
{
    if (nDim > 0x20000000 || nDim < -0x20000000)
    {
        SAL_WARN("sd.filter", "skipping huge dimension: " << nDim);
        return false;
    }
    return true;
}

static bool AllowPoint(const Point& rPoint) { return AllowDim(rPoint.X()) && AllowDim(rPoint.Y()); }

static bool AllowRect(const tools::Rectangle& rRect)
{
    return AllowPoint(rRect.TopLeft()) && AllowPoint(rRect.BottomRight());
}

void ImpSdrPdfImport::ImportText(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                                 std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage,
                                 std::unique_ptr<vcl::pdf::PDFiumTextPage> const& pTextPage,
                                 int /*nPageObjectIndex*/)
{
    basegfx::B2DRectangle aTextRect = pPageObject->getBounds();
    basegfx::B2DHomMatrix aMatrix = pPageObject->getMatrix();

    basegfx::B2DHomMatrix aTextMatrix(maCurrentMatrix);

    aTextRect *= aTextMatrix;

    if (!std::isfinite(aTextRect.getMinX()) || !std::isfinite(aTextRect.getMaxX())
        || !std::isfinite(aTextRect.getMinY()) || !std::isfinite(aTextRect.getMaxY()))
    {
        SAL_WARN("sd.filter", "unusable text rectangle: " << aTextRect);
        return;
    }

    const tools::Rectangle aRect = PointsToLogic(aTextRect.getMinX(), aTextRect.getMaxX(),
                                                 aTextRect.getMinY(), aTextRect.getMaxY());
    if (!AllowRect(aRect))
        return;

    OUString sText = pPageObject->getText(pTextPage);

    OUString sFontName;
    FontWeight eFontWeight(WEIGHT_DONTKNOW);
    bool bNameItalic = false;
    auto xFont = pPageObject->getFont();
    auto itImportedFont
        = xFont ? mxImportedFonts->find(xFont->getFontDictObjNum()) : mxImportedFonts->end();
    if (itImportedFont != mxImportedFonts->end())
    {
        // We expand a name like "Foo" with non-traditional styles like
        // "SemiBold" to "Foo SemiBold";
        sFontName = itImportedFont->sFontName;
        eFontWeight = itImportedFont->eFontWeight;
    }
    else
    {
        sFontName = pPageObject->getFontName();
        SAL_WARN("sd.filter", "font: " << sFontName << " wasn't collected");
        // One of the standard 14 the PDF did not embed (a Type1 Helvetica,
        // Times or Courier, as ReportLab and many generators write). Name
        // the run's font for the bundled METRIC-COMPATIBLE family straight
        // away: left as "Helvetica", the jail's fontconfig (no alias rules)
        // matched DejaVu Sans, whose glyphs are up to 13% wider, and the
        // client — drawing Helvetica into those advances — showed gaps
        // after every wide glyph ("m emos", "com parison"). Liberation Sans,
        // Serif and Mono carry Helvetica/Arial, Times and Courier widths
        // exactly, and the client already pairs them with Arial, Times New
        // Roman and Courier New. Weight and slant ride the name's suffix.
        if (lcl_StandardFontFamily(sFontName, sFontName, eFontWeight, bNameItalic))
            SAL_INFO("sd.filter", "standard font mapped to " << sFontName);
    }

    const double dFontSize = pPageObject->getFontSize();
    double dFontSizeH = fabs(std::hypot(aMatrix.a(), aMatrix.c()) * dFontSize);
    double dFontSizeV = fabs(std::hypot(aMatrix.b(), aMatrix.d()) * dFontSize);

    // We will only really be able to squeeze a font size in whole units of
    // twips through the various layers esp. export and reimport, so work in
    // twips here and LogicToLogic so we don't end up using a value that cannot
    // be roundtripped back.
    const Size aFontSizeTwips(dFontSizeH * 20, dFontSizeV * 20);
    const Size aFontSize(OutputDevice::LogicToLogic(aFontSizeTwips, MapMode(MapUnit::MapTwip),
                                                    MapMode(MapUnit::Map100thMM)));
    vcl::Font aFnt = mpVD->GetFont();
    aFnt.SetFontSize(aFontSize);

    if (!sFontName.isEmpty())
        aFnt.SetFamilyName(sFontName);

    int italicAngle = pPageObject->getFontAngle();
    {
        // Decompose matrix to inspect shear
        basegfx::B2DVector aScale, aTranslate;
        double fRotate, fShearX;
        aMatrix.decompose(aScale, aTranslate, fRotate, fShearX);
        int nTextRotation = basegfx::fround(basegfx::rad2deg<1>(atan(fShearX)));
        // Add this additional shear to the reported italic angle, where
        // rotation to the right is negative
        italicAngle += -nTextRotation;
    }
    aFnt.SetItalic(italicAngle == 0 ? ITALIC_NONE
                                    : (italicAngle < 0 ? ITALIC_NORMAL : ITALIC_OBLIQUE));
    if (bNameItalic && aFnt.GetItalic() == ITALIC_NONE)
        aFnt.SetItalic(ITALIC_NORMAL);
    aFnt.SetWeight(eFontWeight);

    if (aFnt != mpVD->GetFont())
    {
        mpVD->SetFont(aFnt);
        mbFntDirty = true;
    }

    Color aTextColor(COL_TRANSPARENT);
    bool bFill = false;
    bool bUse = true;
    bool bInvisible = false;
    switch (pPageObject->getTextRenderMode())
    {
        case vcl::pdf::PDFTextRenderMode::Fill:
        case vcl::pdf::PDFTextRenderMode::FillClip:
        case vcl::pdf::PDFTextRenderMode::FillStroke:
        case vcl::pdf::PDFTextRenderMode::FillStrokeClip:
            bFill = true;
            break;
        case vcl::pdf::PDFTextRenderMode::Stroke:
        case vcl::pdf::PDFTextRenderMode::StrokeClip:
        case vcl::pdf::PDFTextRenderMode::Unknown:
            break;
        case vcl::pdf::PDFTextRenderMode::Invisible:
            bInvisible = true;
            bUse = false;
            break;
        case vcl::pdf::PDFTextRenderMode::Clip:
            bUse = false;
            break;
    }
    if (bUse)
    {
        Color aColor
            = bFill ? getFillColor(pPageObject, pPage) : getStrokeColor(pPageObject, pPage);
        if (aColor != COL_TRANSPARENT)
            aTextColor = aColor.GetRGBColor();
    }

    if (aTextColor != mpVD->GetTextColor())
    {
        mpVD->SetTextColor(aTextColor);
        mbFntDirty = true;
    }

    collectPageChars(pTextPage);
    if (!InsertTextSegments(aRect, sText, bInvisible))
        InsertTextObject(aRect.TopLeft(), aRect.GetSize(), sText, bInvisible);
}

namespace
{
bool lcl_IsSpace(sal_uInt32 nCode)
{
    return nCode == ' ' || nCode == '\t' || nCode == 0xA0 || nCode == '\n' || nCode == '\r';
}

/// A PDF standard-14 (or Arial) font name, as a base font is written
/// ("Helvetica-BoldOblique", "Times-Roman", "Courier-Bold", "ABCDEF+Arial,Bold"),
/// mapped to the bundled family with the same advance widths. Returns false
/// for any other font, leaving the name alone.
bool lcl_StandardFontFamily(const OUString& rName, OUString& rFamily, FontWeight& rWeight,
                            bool& rItalic)
{
    OUString aName = rName;
    const sal_Int32 nPlus = aName.indexOf('+');
    if (nPlus == 6)
        aName = aName.copy(7); // subset tag
    const OUString aLower = aName.toAsciiLowerCase();
    OUString aFamily;
    if (aLower.startsWith("helvetica") || aLower.startsWith("arial"))
        aFamily = u"Liberation Sans"_ustr;
    else if (aLower.startsWith("times"))
        aFamily = u"Liberation Serif"_ustr;
    else if (aLower.startsWith("courier"))
        aFamily = u"Liberation Mono"_ustr;
    else
        return false;
    if (aLower.indexOf("bold") >= 0 || aLower.indexOf("black") >= 0
        || aLower.indexOf("heavy") >= 0)
        rWeight = WEIGHT_BOLD;
    else if (rWeight == WEIGHT_DONTKNOW)
        rWeight = WEIGHT_NORMAL;
    rItalic = aLower.indexOf("italic") >= 0 || aLower.indexOf("oblique") >= 0;
    rFamily = aFamily;
    return true;
}
}

void ImpSdrPdfImport::collectPageChars(
    std::unique_ptr<vcl::pdf::PDFiumTextPage> const& pTextPage)
{
    if (mpPageCharsFor == pTextPage.get())
        return;
    mpPageCharsFor = pTextPage.get();
    maPageChars.clear();
    maPageNonSpace.clear();
    mnPageRunCursor = 0;
    if (!pTextPage)
        return;
    const double fPageHeight = convertPointToMm100(mdPageHeightPts);
    const int nChars = pTextPage->countChars();
    if (nChars > 0)
        maPageChars.reserve(static_cast<size_t>(nChars));
    for (int i = 0; i < nChars; ++i)
        maPageChars.push_back({ pTextPage->getUnicode(i), pTextPage->getCharBox(i, fPageHeight) });
    for (size_t k = 0; k < maPageChars.size(); ++k)
        if (!lcl_IsSpace(maPageChars[k].nCode) && !maPageChars[k].aBox.isEmpty())
            maPageNonSpace.push_back(k);
}

// pdfium hands the importer one text object per text-showing operator, with
// the object's glyphs in content-stream order and ONE bounding box. A page
// whose stream draws a line's text and then moves back to the margin for its
// line number inside the same object arrives as "...a new section.3" placed
// at the margin; a justified line arrives as one run whose extra word space
// the importer would spread across every letter. The page's per-glyph boxes
// know where each glyph is: cut the object where the glyph run jumps back,
// jumps forward more than a wide space (three quarters of an em) or changes
// line, and insert one text object per run, each at its own box.
bool ImpSdrPdfImport::InsertTextSegments(const tools::Rectangle& rObjRect, const OUString& rText,
                                         bool bInvisible)
{
    // Invisible text (render mode 3 — an OCR layer under a scan) is not
    // something a person can see or edit: as an object it reached the canvas
    // as white, hit-testable text over the picture. Leave it to the
    // document's own bytes, which a text-only session keeps.
    if (bInvisible)
        return true;
    if (maPageChars.empty() || rText.isEmpty())
        return false;

    tools::Long nEm = mpVD->GetFont().GetFontHeight();
    if (nEm <= 0)
        nEm = 423; // 12 pt
    tools::Rectangle aRect(rObjRect);
    aRect.Normalize();
    const double fTol = nEm * 0.3;
    const double fLeft = aRect.Left() - fTol, fRight = aRect.Right() + fTol;
    const double fTop = aRect.Top() - fTol, fBottom = aRect.Bottom() + fTol;
    auto inBox = [&](const basegfx::B2DRectangle& rBox) {
        const double fCx = (rBox.getMinX() + rBox.getMaxX()) / 2.0;
        const double fCy = (rBox.getMinY() + rBox.getMaxY()) / 2.0;
        return fCx >= fLeft && fCx <= fRight && fCy >= fTop && fCy <= fBottom;
    };

    // The object's glyphs are one contiguous run of the page's glyphs in
    // page order (spaces aside), and pdfium's text page keeps stream order,
    // so the run is found by content and checked against the object's box.
    // Another object's glyphs may sit inside that box (a word drawn on its
    // own beside this one), which is why the box alone cannot pick them.
    std::vector<sal_uInt32> aWanted;
    for (sal_Int32 i = 0; i < rText.getLength();)
    {
        const sal_uInt32 nCode = rText.iterateCodePoints(&i);
        if (!lcl_IsSpace(nCode))
            aWanted.push_back(nCode);
    }
    if (aWanted.empty() || aWanted.size() > maPageNonSpace.size())
        return false;
    // Search from where the previous object's run ended, not from the top of
    // the page: objects arrive in stream order and the text page keeps it,
    // and a Chrome/HTML export draws every glyph as its own object, so the
    // second "e" of "Three" — 0.05 em from the first, well inside the box
    // tolerance — otherwise matched the FIRST "e" and was placed on top of
    // it ("Thr" and a doubled "e"), while "al l" and "0 1" came apart the
    // same way. The top-of-page search stays as the fallback for a page
    // whose objects are not in text order.
    auto findRun = [&](size_t nFrom) -> size_t {
        for (size_t k = nFrom; k + aWanted.size() <= maPageNonSpace.size(); ++k)
        {
            bool bMatch = true;
            for (size_t m = 0; m < aWanted.size() && bMatch; ++m)
                bMatch = maPageChars[maPageNonSpace[k + m]].nCode == aWanted[m];
            if (!bMatch)
                continue;
            bool bInside = true;
            for (size_t m = 0; m < aWanted.size() && bInside; ++m)
                bInside = inBox(maPageChars[maPageNonSpace[k + m]].aBox);
            if (bInside)
                return k;
        }
        return maPageNonSpace.size();
    };
    size_t nRunStart = findRun(mnPageRunCursor);
    if (nRunStart >= maPageNonSpace.size() && mnPageRunCursor > 0)
        nRunStart = findRun(0);
    if (nRunStart >= maPageNonSpace.size())
        return false;
    mnPageRunCursor = nRunStart + aWanted.size();
    const size_t nFirstChar = maPageNonSpace[nRunStart];
    size_t nLastChar = maPageNonSpace[nRunStart + aWanted.size() - 1];
    // The range ends on the last NON-space glyph, so a space the object
    // draws after its last word — the word gap before the next object on
    // the line ("ION WELL " then "PERMIT") — was never inside it, and the
    // joined line read "WELLPERMIT". Take the object's own trailing
    // spaces into the range; the segment builder emits them as spaces.
    // A space whose box pdfium measured as (near) zero wide is a kerning
    // device, not a word gap: a permit form's title draws "INJECT" then a
    // zero-width space then "ION", and reads INJECTION. A box pdfium left
    // uninitialised says nothing, and such a space stays a space.
    auto lcl_IsZeroWidthSpace = [nEm](const PageChar& rChar) {
        return lcl_IsSpace(rChar.nCode) && !rChar.aBox.isEmpty()
               && rChar.aBox.getWidth() <= nEm * 0.05;
    };
    sal_Int32 nTrailing = 0;
    for (sal_Int32 i = rText.getLength() - 1; i >= 0 && lcl_IsSpace(rText[i]); --i)
        ++nTrailing;
    // The object's text ends in a space ("MPH, " before "Executive
    // Director"). The text page may offer it as a GENERATED space with a
    // zero-width box (which the kerning rule below would drop), or not at
    // all (an empty text object comes first) — but pdfium also ENDS a run's
    // text with such a space where the next run merely kerns on ("INJECT"
    // then "ION"). What the glyphs do decides: the run keeps a trailing
    // space when the next glyph on the line stands a real gap away from its
    // last one, and none when they touch.
    // The run's own glyph-to-glyph gap (median): a letter-spaced title
    // stands its glyphs a point apart everywhere, so a fixed fraction of an
    // em read its own tracking as a word gap ("INJECT ION" once more). A
    // gap is a word gap when it clearly exceeds what the run does between
    // any two of its glyphs.
    double fRunGap = 0.0;
    {
        std::vector<double> aGaps;
        const PageChar* pPrevGlyph = nullptr;
        for (size_t k = nFirstChar; k <= nLastChar; ++k)
        {
            const PageChar& rChar = maPageChars[k];
            if (lcl_IsSpace(rChar.nCode) || rChar.aBox.isEmpty())
                continue;
            if (pPrevGlyph)
                aGaps.push_back(rChar.aBox.getMinX() - pPrevGlyph->aBox.getMaxX());
            pPrevGlyph = &rChar;
        }
        if (!aGaps.empty())
        {
            std::sort(aGaps.begin(), aGaps.end());
            fRunGap = std::max(0.0, aGaps[aGaps.size() / 2]);
        }
    }
    // The threshold is per run and does not need a floor: a one-glyph object
    // (a Chrome/HTML export draws every glyph as its own) only reaches here
    // when pdfium ended its text with a space, i.e. pdfium already judged a
    // word gap from the font's advances, and the ink test merely rejects the
    // zero-width kerning device. A floor of 0.15 em was tried and dropped the
    // real space after "Three" (an "e" then a hooked "j" leave 0.126 em of
    // ink gap under tight tracking).
    auto lcl_IsWordGap = [nEm, fRunGap](double fGap) {
        return fGap > 2.0 * fRunGap + nEm * 0.05;
    };
    bool bOwnTrailingSpace = false;
    if (nTrailing > 0)
    {
        const PageChar& rLast = maPageChars[nLastChar];
        const PageChar* pNextGlyph = nullptr;
        for (size_t k = nLastChar + 1; k < maPageChars.size() && !pNextGlyph; ++k)
            if (!lcl_IsSpace(maPageChars[k].nCode) && !maPageChars[k].aBox.isEmpty())
                pNextGlyph = &maPageChars[k];
        if (!pNextGlyph || rLast.aBox.isEmpty())
            bOwnTrailingSpace = true; // nothing follows on the page: harmless
        else
        {
            const double fLastCy = (rLast.aBox.getMinY() + rLast.aBox.getMaxY()) / 2.0;
            const double fNextCy = (pNextGlyph->aBox.getMinY() + pNextGlyph->aBox.getMaxY()) / 2.0;
            const bool bSameLine = std::abs(fNextCy - fLastCy) <= nEm * 0.4;
            bOwnTrailingSpace
                = !bSameLine || lcl_IsWordGap(pNextGlyph->aBox.getMinX() - rLast.aBox.getMaxX());
        }
    }
    while (nTrailing > 0 && nLastChar + 1 < maPageChars.size()
           && lcl_IsSpace(maPageChars[nLastChar + 1].nCode))
    {
        ++nLastChar;
        --nTrailing;
    }
    std::vector<const PageChar*> aGlyphs;
    aGlyphs.reserve(nLastChar - nFirstChar + 1);
    double fRunTop = 0.0, fRunBottom = 0.0;
    bool bRunExtent = false;
    for (size_t k = nFirstChar; k <= nLastChar; ++k)
    {
        const PageChar& rChar = maPageChars[k];
        if (lcl_IsSpace(rChar.nCode) || rChar.aBox.isEmpty())
        {
            if (lcl_IsSpace(rChar.nCode))
                aGlyphs.push_back(&rChar);
            continue;
        }
        aGlyphs.push_back(&rChar);
        if (!bRunExtent)
        {
            fRunTop = rChar.aBox.getMinY();
            fRunBottom = rChar.aBox.getMaxY();
            bRunExtent = true;
        }
        else
        {
            fRunTop = std::min(fRunTop, rChar.aBox.getMinY());
            fRunBottom = std::max(fRunBottom, rChar.aBox.getMaxY());
        }
    }
    // The importer's placement was calibrated on pdfium's OBJECT box (font
    // ascent/descent), not on glyph ink: give every run the object box's
    // vertical extent relative to the glyphs, so a run lands where the
    // whole object would have.
    const double fTopDelta = aRect.Top() - fRunTop;
    const double fBottomDelta = aRect.Bottom() - fRunBottom;

    // Does this object carry real space glyphs? A Chrome/HTML export writes a
    // space character between words; a justified legal line does not, and
    // arrives as one run whose word breaks are only positional. The
    // positional-space recovery below is for the latter and MUST NOT run for
    // the former: there a wide forward gap is a glyph's own side bearing (an
    // 'r' before an 'a', an apostrophe before 's'), and inserting a space
    // there shatters the word ("Montserr at", "Sheriff 's").
    bool bHasRealSpaces = false;
    for (const PageChar* pChar : aGlyphs)
        if (lcl_IsSpace(pChar->nCode))
        {
            bHasRealSpaces = true;
            break;
        }

    // Cut into runs.
    struct Segment
    {
        OUStringBuffer aText;
        basegfx::B2DRectangle aBox;
        const PageChar* pLast = nullptr;
    };
    std::vector<Segment> aSegments;
    for (size_t nGlyph = 0; nGlyph < aGlyphs.size(); ++nGlyph)
    {
        const PageChar* pChar = aGlyphs[nGlyph];
        if (lcl_IsSpace(pChar->nCode))
        {
            if (aSegments.empty() || aSegments.back().aText.isEmpty())
                continue;
            bool bWordGap = !lcl_IsZeroWidthSpace(*pChar);
            if (!bWordGap)
            {
                // A zero-width space is a kerning device ("INJECT" + "ION")
                // only when the glyphs around it touch. pdfium also marks a
                // real word gap with a generated, zero-width space ("MPH,"
                // then "Executive" 0.35 em on): the neighbours' distance
                // tells the two apart.
                const PageChar* pPrev = aSegments.back().pLast;
                const PageChar* pNext = nullptr;
                for (size_t k = nGlyph + 1; k < aGlyphs.size() && !pNext; ++k)
                    if (!lcl_IsSpace(aGlyphs[k]->nCode) && !aGlyphs[k]->aBox.isEmpty())
                        pNext = aGlyphs[k];
                if (pPrev && pNext)
                    bWordGap = lcl_IsWordGap(pNext->aBox.getMinX() - pPrev->aBox.getMaxX());
            }
            if (bWordGap)
                aSegments.back().aText.append(' ');
            continue;
        }
        // A new OBJECT only where the text jumps BACK (a run drawn to the
        // left of where the previous ended — a line number returned to the
        // margin, a second column) or drops to a NEW LINE. A wide FORWARD
        // gap on the same line is a word space, not a new object: keep it in
        // the run and insert a space, so "AN ACT Relating to designating"
        // stays one object with its spaces instead of splitting into
        // "Relating" / "to" and losing them.
        bool bNewRun = aSegments.empty();
        const PageChar* pPrev = aSegments.empty() ? nullptr : aSegments.back().pLast;
        if (pPrev)
        {
            const double fPrevCy = (pPrev->aBox.getMinY() + pPrev->aBox.getMaxY()) / 2.0;
            const double fCy = (pChar->aBox.getMinY() + pChar->aBox.getMaxY()) / 2.0;
            if (pChar->aBox.getMinX() < pPrev->aBox.getMinX() - nEm * 0.25
                || std::abs(fCy - fPrevCy) > nEm * 0.4)
                bNewRun = true;
        }
        if (bNewRun)
            aSegments.emplace_back();
        Segment& rSeg = aSegments.back();
        if (!bNewRun && !bHasRealSpaces && rSeg.pLast && !rSeg.aText.isEmpty())
        {
            // Word separated by position rather than a space glyph — only when
            // the object has no real spaces (see bHasRealSpaces above), so a
            // side-bearing gap inside a word is never mistaken for a space.
            const double fGap = pChar->aBox.getMinX() - rSeg.pLast->aBox.getMaxX();
            const sal_Int32 nLen = rSeg.aText.getLength();
            if (fGap > nEm * 0.2 && rSeg.aText[nLen - 1] != ' ')
                rSeg.aText.append(' ');
        }
        rSeg.aText.appendUtf32(pChar->nCode);
        rSeg.aBox.expand(pChar->aBox);
        rSeg.pLast = pChar;
    }
    if (aSegments.empty())
        return false; // no glyphs matched: let the caller insert the object
    if (bOwnTrailingSpace && !aSegments.back().aText.isEmpty()
        && aSegments.back().aText[aSegments.back().aText.getLength() - 1] != ' ')
        aSegments.back().aText.append(' ');

    for (Segment& rSeg : aSegments)
    {
        // Text source. A split object rebuilds each run's text from its
        // glyphs. A single run does too WHEN the object carries real space
        // glyphs: pdfium's getText (rText) inserts a space at any wide
        // positioning gap, which for a Chrome/HTML export is a glyph's own
        // side bearing — an 'r' before an 'a', an 'f' before an apostrophe —
        // so a word shatters mid-way ("Montserr at", "Sheriff 's"); the
        // glyph-built text carries only the real spaces (fGap recovery is off
        // once real spaces are present). A single run with NO space glyphs is
        // a positional/justified line where only pdfium's getText knows where
        // the words break, so trust rText there.
        OUString aRaw = (aSegments.size() == 1 && !bHasRealSpaces)
                            ? rText
                            : rSeg.aText.makeStringAndClear();
        // Trim leading whitespace and trailing tabs/newlines, but KEEP a
        // trailing space. A Chrome/HTML export draws each glyph as its own text
        // object and marks a word break with a trailing space on the word's
        // last glyph ("s ", "e ", "t "); a plain trim() drops it, and the
        // structuring pass then has to reconstruct word spaces from glyph gaps
        // — which turns a side bearing into a space mid-word ("Sheriff 's").
        // Keeping it lets the pass see the real spaces and skip that recovery.
        sal_Int32 nTrimB = 0, nTrimE = aRaw.getLength();
        while (nTrimB < nTrimE
               && (aRaw[nTrimB] == ' ' || aRaw[nTrimB] == '\t'
                   || aRaw[nTrimB] == '\n' || aRaw[nTrimB] == '\r'))
            ++nTrimB;
        while (nTrimE > nTrimB
               && (aRaw[nTrimE - 1] == '\t' || aRaw[nTrimE - 1] == '\n'
                   || aRaw[nTrimE - 1] == '\r'))
            --nTrimE;
        OUString aText = aRaw.copy(nTrimB, nTrimE - nTrimB);
        if (aText.isEmpty() || rSeg.aBox.isEmpty())
            continue;
        // InsertTextObject takes the box as the importer's PointsToLogic
        // hands it: the position is the visual bottom-left, the height
        // negative (see ImportText).
        const tools::Long nL = basegfx::fround(rSeg.aBox.getMinX());
        const tools::Long nR = basegfx::fround(rSeg.aBox.getMaxX());
        const tools::Long nT = basegfx::fround(rSeg.aBox.getMinY() + fTopDelta);
        const tools::Long nB = basegfx::fround(rSeg.aBox.getMaxY() + fBottomDelta);
        InsertTextObject(Point(nL, nB), Size(nR - nL, nT - nB), aText, bInvisible);
    }
    return true;
}

void ImpSdrPdfImport::InsertTextObject(const Point& rPos, const Size& rSize, const OUString& rStr,
                                       bool bInvisible)
{
    if (bInvisible)
        return; // see InsertTextSegments
    FontMetric aFontMetric(mpVD->GetFontMetric());
    vcl::Font aFont(mpVD->GetFont());
    assert(aFont.GetAlignment() == ALIGN_BASELINE);

    /* Get our text bounds of this text, which is nominally relative to a 0
       left margin, so we know where the inked rect begins relative to the
       start of the text area, and we can adjust the pdf rectangle by that so
       the SdrRectObj text will get rendered at the same x position.

       Similarly find the relative vertical distance from the inked bounds
       to the baseline and adjust the pdf rect so the SdrRectObj will render
       the text at the same y position.
    */
    tools::Rectangle aOurRect;
    (void)mpVD->GetTextBoundRect(aOurRect, rStr);

    auto nXDiff = aOurRect.Left();
    auto nYDiff = aFontMetric.GetDescent() - aOurRect.Bottom();

    Point aPos(rPos.X() - nXDiff, rPos.Y() + nYDiff);

    // Natural advance width of the string in the resolved font with no
    // extra character spacing.
    const tools::Long nVclTextWidth = mpVD->GetTextWidth(rStr);

    // To detect PDF character spacing, compare inked widths on both
    // sides. FPDFPageObj_GetBounds (and therefore rSize) reports the
    // rendered ink bounds, which exclude the left bearing of the first
    // glyph and the right bearing of the last glyph. Compare that
    // against VCL's ink bounds from GetTextBoundRect, not against the
    // advance width, or the bearings show up as spurious spacing and
    // produce excessive kerning on short runs like "ld".
    const tools::Long nVclInkedWidth = aOurRect.GetWidth();
    const tools::Long nPdfInkedWidth = rSize.Width();

    short nExtraKerning = 0;
    const sal_Int32 nChars = rStr.getLength();
    if (nChars > 1 && nVclInkedWidth > 0 && nPdfInkedWidth > 0)
    {
        // Round the per-character kern, never truncate. The kern is ONE
        // integer 1/100 mm value applied to every character of the run, so a
        // dropped fraction is paid once per character and walks the run off
        // the end of the line it came from: a 114-character body line
        // finished 3.2 pt short of where the PDF drew it. Rounding centres
        // that error instead of accumulating it.
        const double fKern = static_cast<double>(nPdfInkedWidth - nVclInkedWidth)
                             / static_cast<double>(nChars - 1);
        // The two directions need different bounds because they mean
        // different things. LETTERSPACING is a design device and it is not
        // small: the eyebrows, rules and footers of this corpus are drawn
        // with 0.9 pt of character spacing on a 6.9 pt face — 0.13 em — and
        // clamping the correction at zero left every one of those lines
        // wider than the PDF drew it. Allow a quarter of an em. TIGHTENING,
        // on the other hand, is rare and small, and a large negative
        // correction almost always means the string and the box are not
        // measuring the same run; cap it at a twentieth of an em AND at a
        // tenth of the run, so a mismatch can never walk a line off its page
        // position.
        const double fEm = static_cast<double>(aFont.GetFontHeight());
        const double fCeil = fEm * 0.25;
        const double fFloor = std::max(-fEm / 20.0, -static_cast<double>(nPdfInkedWidth) / 10.0
                                                        / static_cast<double>(nChars - 1));
        // The kern is stored in a short: a quarter em of a font taller than
        // ~3700 pt exceeds it, and the cast would wrap to a large negative
        // kern. Clamp the bounds into the short's range first (and keep
        // floor <= ceil, which std::clamp requires).
        const tools::Long nCeil = std::clamp<tools::Long>(basegfx::fround<tools::Long>(fCeil),
                                                          SAL_MIN_INT16, SAL_MAX_INT16);
        const tools::Long nFloor = std::clamp<tools::Long>(basegfx::fround<tools::Long>(fFloor),
                                                           SAL_MIN_INT16, nCeil);
        nExtraKerning = static_cast<short>(
            std::clamp<tools::Long>(basegfx::fround<tools::Long>(fKern), nFloor, nCeil));
    }

    // As per ImpEditEngine::CalcParaWidth the width of the text box has to be 1 unit wider than the text
    const tools::Long nTextWidth
        = std::max<tools::Long>(
            1, nVclTextWidth + static_cast<tools::Long>(nExtraKerning) * (nChars - 1) + 1);
    // The frame's height decides where the FIRST BASELINE lands: with zero
    // text distances the layout puts it at frame top + ascent, and the frame
    // bottom sits at baseline + descent (nYDiff above). A fixed 1.2 x size
    // only lands the baseline where the PDF had it for fonts whose
    // ascent + descent happens to be 1.2 em (Public Sans); Spectral's is
    // ~1.46 em, so every Spectral run came back 0.26 em LOWER than the
    // original (+7pt on a 27pt headline). Use the resolved font's own
    // ascent + descent — the same metrics the layout will use.
    tools::Long nLineHeight = aFontMetric.GetAscent() + aFontMetric.GetDescent();
    if (nLineHeight <= 0)
        nLineHeight = basegfx::fround<tools::Long>(aFont.GetFontHeight() * 1.2);
    Size aSize(nTextWidth, -nLineHeight);

    Point aSdrPos(basegfx::fround<tools::Long>(aPos.X() * mfScaleX + maOfs.X()),
                  basegfx::fround<tools::Long>(aPos.Y() * mfScaleY + maOfs.Y()));
    Size aSdrSize(basegfx::fround<tools::Long>(aSize.Width() * mfScaleX),
                  basegfx::fround<tools::Long>(aSize.Height() * mfScaleY));

    tools::Rectangle aTextRect(aSdrPos, aSdrSize);
    rtl::Reference<SdrRectObj> pText = new SdrRectObj(*mpModel, aTextRect, SdrObjKind::Text);

    pText->SetMergedItem(makeSdrTextUpperDistItem(0));
    pText->SetMergedItem(makeSdrTextLowerDistItem(0));
    pText->SetMergedItem(makeSdrTextRightDistItem(0));
    pText->SetMergedItem(makeSdrTextLeftDistItem(0));

    pText->SetMergedItem(makeSdrTextAutoGrowHeightItem(false));
    // The box is the run's own glyph extent and stays that way: never grow
    // the width and never wrap. Growing measured with the fallback font,
    // which is wider than the PDF's own, and inflated the box past the run's
    // real width — so same-line runs looked like they overlapped and
    // paragraph grouping fragmented. Word wrap off keeps the run on one line.
    pText->SetMergedItem(SdrTextHorzAdjustItem(SDRTEXTHORZADJUST_LEFT));
    pText->SetMergedItem(makeSdrTextAutoGrowWidthItem(false));
    pText->SetMergedItem(makeSdrTextWordWrapItem(false));

    // We want font independent line spacing for PDF
    pText->SetMergedItem(SdrTextFixedCellHeightItem(true));

    if (bInvisible)
        pText->SetVisible(false);

    pText->SetLayer(mnLayer);
    pText->NbcSetText(rStr);
    SetAttributes(pText.get(), true);
    if (nExtraKerning != 0)
    {
        const tools::Long nKernSdr = basegfx::fround<tools::Long>(nExtraKerning * mfScaleX);
        pText->SetMergedItem(SvxKerningItem(
            static_cast<short>(std::clamp<tools::Long>(nKernSdr, SAL_MIN_INT16, SAL_MAX_INT16)),
            EE_CHAR_KERNING));
    }
    pText->SetSnapRect(aTextRect);

    if (!aFont.IsTransparent())
    {
        SfxItemSet aAttr(SfxItemSet::makeFixedSfxItemSet<XATTR_FILL_FIRST, XATTR_FILL_LAST>(
            *mpFillAttr->GetPool()));
        aAttr.Put(XFillStyleItem(drawing::FillStyle_SOLID));
        aAttr.Put(XFillColorItem(OUString(), aFont.GetFillColor()));
        pText->SetMergedItemSet(aAttr);
    }
    Degree100 nAngle = to<Degree100>(aFont.GetOrientation());
    if (nAngle)
        pText->SdrAttrObj::NbcRotate(aSdrPos, nAngle);
    InsertObj(pText.get(), false);
}

void ImpSdrPdfImport::MapScaling()
{
    const size_t nCount(maTmpList.size());
    const MapMode& rMap = mpVD->GetMapMode();
    Point aMapOrg(rMap.GetOrigin());
    bool bMov2(aMapOrg.X() != 0 || aMapOrg.Y() != 0);

    if (bMov2)
    {
        for (size_t i = mnMapScalingOfs; i < nCount; i++)
        {
            SdrObject* pObj = maTmpList[i].get();

            pObj->NbcMove(Size(aMapOrg.X(), aMapOrg.Y()));
        }
    }

    mnMapScalingOfs = nCount;
}

basegfx::B2DPolyPolygon
ImpSdrPdfImport::GetClip(const std::unique_ptr<vcl::pdf::PDFiumClipPath>& pClipPath,
                         const basegfx::B2DHomMatrix& rPathMatrix,
                         const basegfx::B2DHomMatrix& rTransform)
{
    basegfx::B2DPolyPolygon aClipPolyPoly;

    int nClipPathCount = pClipPath->getPathCount();
    for (int i = 0; i < nClipPathCount; ++i)
    {
        std::vector<std::unique_ptr<vcl::pdf::PDFiumPathSegment>> aPathSegments;
        const int nSegments = pClipPath->getPathSegmentCount(i);
        for (int nSegmentIndex = 0; nSegmentIndex < nSegments; ++nSegmentIndex)
            aPathSegments.push_back(pClipPath->getPathSegment(i, nSegmentIndex));

        appendSegmentsToPolyPoly(aClipPolyPoly, aPathSegments, rPathMatrix);
    }

    aClipPolyPoly.transform(rTransform);

    return aClipPolyPoly;
}

void ImpSdrPdfImport::ImportImage(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                                  std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage,
                                  int /*nPageObjectIndex*/)
{
    // The image AS DRAWN, not its bare samples: a logo is a JPEG with a
    // soft mask, and the bare samples put it on a black field (the mask is
    // what cut it out). pdfium renders the object with mask, colour key and
    // decode applied, sized by its matrix in page points — so the matrix is
    // scaled up to the source's own pixel size for the render and put back,
    // or a 630 px logo would come back at its 151 pt width. Falls back to
    // the bare samples when the render is refused.
    //
    // Except an image whose own JPEG stream is exactly what pdfium draws:
    // that comes in as the JPEG itself (a NativeJpg GfxLink), so a save
    // writes it through instead of re-encoding it (lcl_ImportPassthroughJpeg).
    //
    // Every image object carries where it came from (svx::vulcan::
    // ImageProvenance): its own pixel size, and inside a processed PDF (P0)
    // the innermost /VulcanImg mark's VulcanId with the raw stream's sha256.
    // The page model builder keeps a scan by that reference (keep-by-mark).
    // The raw stream is read and hashed only for a marked image.
    auto pProvenance = std::make_unique<svx::vulcan::ImageProvenance>();
    if (pPage)
        pProvenance->maPixels = pPageObject->getImageSize(*pPage);
    pProvenance->maId = lcl_VulcanImageId(*pPageObject);
    if (!pProvenance->maId.isEmpty())
    {
        const std::vector<sal_uInt8> aRaw = pPageObject->getImageDataRaw();
        if (!aRaw.empty())
        {
            const std::string aHex = comphelper::hashToString(comphelper::Hash::calculateHash(
                aRaw.data(), aRaw.size(), comphelper::HashType::SHA256));
            pProvenance->maSha256 = OString(aHex.c_str(), static_cast<sal_Int32>(aHex.size()));
        }
    }

    Graphic aGraphic;
    if (pPage && mpPdfDocument)
        aGraphic = lcl_ImportPassthroughJpeg(*pPageObject, *pPage, *mpPdfDocument);
    // A bilevel image comes in bilevel, at its own resolution.
    if (aGraphic.GetType() == GraphicType::NONE && pPage && mpPdfDocument)
        aGraphic = lcl_ImportBilevel(*pPageObject, *pPage, *mpPdfDocument);
    std::unique_ptr<vcl::pdf::PDFiumBitmap> bitmap;
    bool bNative = false;
    if (aGraphic.GetType() == GraphicType::NONE && pPage && mpPdfDocument)
    {
        const basegfx::B2DHomMatrix aImageMatrix = pPageObject->getMatrix();
        const Size aPixels = pPageObject->getImageSize(*pPage);
        const double fWidthPt = std::hypot(aImageMatrix.a(), aImageMatrix.b());
        const double fHeightPt = std::hypot(aImageMatrix.c(), aImageMatrix.d());
        // A page scan is held at its own resolution (within
        // fNativePixelBudget), not at the display budget below: the cover
        // under an edited line is a real edit of these pixels, and the save
        // writes them - at the display budget an edited 300 dpi page would
        // lose resolution for good. A page scan is an image a processed PDF
        // marked, or a grey or palette image drawn over half the page or
        // more (a scan the canvas saved before: the export writes an edited
        // grey scan as 8-bit Indexed, and carries no marks). Unmarked colour
        // pictures keep the display budget: a brochure's full-page photos,
        // held natively on every decomposed page, would multiply the kit's
        // memory.
        const double fPageArea = pPage->getWidth() * pPage->getHeight();
        const vcl::pdf::PDFImageColorSpace eColorSpace = pPageObject->getImageColorSpace(*pPage);
        const bool bGreyOrPalette = eColorSpace == vcl::pdf::PDFImageColorSpace::DeviceGray
                                    || eColorSpace == vcl::pdf::PDFImageColorSpace::CalGray
                                    || eColorSpace == vcl::pdf::PDFImageColorSpace::Indexed;
        bNative = !pProvenance->maId.isEmpty()
                  || (bGreyOrPalette && fPageArea > 0.0
                      && fWidthPt * fHeightPt >= 0.5 * fPageArea);
        // The render's pixels per point: the source's own resolution, but
        // never more than this (a tiny image drawn large must not explode).
        // Held natively, the finer axis decides, so a 204 x 98 dpi fax keeps
        // its 204 dpi across.
        constexpr double fMaxRenderScale = 8.0;
        double fScale = 1.0;
        if (fWidthPt > 0.0 && fHeightPt > 0.0 && aPixels.Width() > 0 && aPixels.Height() > 0)
        {
            const double fX = aPixels.Width() / fWidthPt;
            const double fY = aPixels.Height() / fHeightPt;
            fScale = std::clamp(bNative ? std::max(fX, fY) : std::min(fX, fY), 1.0,
                                fMaxRenderScale);
        }
        // A pixel budget per rendered image: the render is a 32-bit bitmap
        // held for every page at once, and a full-page scan rendered at its
        // own 300 dpi is 34 MB. Four megapixels keeps a letter page sharp at
        // roughly 2x its point size and bounds the document's memory.
        // The budget bounds the render in BOTH directions: pdfium sizes the
        // bitmap by the object's MATRIX, not by the file's samples, so an
        // image drawn at 30000 x 30000 pt would be a 3.6 GB render even at
        // 1x - the budget scales the matrix below 1x for it.
        const double fPixelBudget = bNative ? fNativePixelBudget : 4.0e6;
        const double fDrawnPixels = fWidthPt * fHeightPt;
        bool bRender = std::isfinite(fDrawnPixels) && fDrawnPixels > 0.0;
        if (bRender && fDrawnPixels * fScale * fScale > fPixelBudget)
            fScale = std::sqrt(fPixelBudget / fDrawnPixels);
        // Scaled under a pixel on either side the render holds nothing: take
        // the file's own samples below instead.
        if (bRender && (fWidthPt * fScale < 1.0 || fHeightPt * fScale < 1.0))
            bRender = false;
        if (bRender)
        {
            const bool bRescale = std::abs(fScale - 1.0) > 0.01;
            if (bRescale)
            {
                basegfx::B2DHomMatrix aScaled(aImageMatrix);
                aScaled.scale(fScale, fScale);
                pPageObject->setMatrix(aScaled);
            }
            bitmap = pPageObject->getRenderedImage(*mpPdfDocument, *pPage);
            if (bRescale)
                pPageObject->setMatrix(aImageMatrix);
        }
    }
    if (aGraphic.GetType() == GraphicType::NONE)
    {
        if (!bitmap)
            bitmap = pPageObject->getImageBitmap();
        if (!bitmap)
        {
            SAL_WARN("sd.filter", "Failed to get IMAGE");
            return;
        }

        const vcl::pdf::PDFBitmapType format = bitmap->getFormat();
        if (format == vcl::pdf::PDFBitmapType::Unknown)
        {
            SAL_WARN("sd.filter", "Failed to get IMAGE format");
            return;
        }
        // A page scan held natively is also held compactly: a grey scan as
        // 8-bit grey, not 32-bit BGRA (the export would write that as RGB
        // plus a soft mask).
        if (bNative && format == vcl::pdf::PDFBitmapType::BGRA)
            aGraphic = Graphic(lcl_CompactBitmap(*bitmap));
        else
            aGraphic = Graphic(bitmap->createBitmapFromBuffer());
    }

    basegfx::B2DRectangle aBounds = pPageObject->getBounds();
    float left = aBounds.getMinX();
    // Upside down.
    float bottom = aBounds.getMinY();
    float right = aBounds.getMaxX();
    // Upside down.
    float top = aBounds.getMaxY();

    bool bEntirelyClippedOut = false;

    auto aPathMatrix = pPageObject->getMatrix();

    aPathMatrix *= maCurrentMatrix;

    const basegfx::B2DHomMatrix aTransform(
        basegfx::utils::createScaleTranslateB2DHomMatrix(mfScaleX, mfScaleY, maOfs.X(), maOfs.Y()));

    basegfx::B2DPolyPolygon aClipPolyPoly
        = GetClip(pPageObject->getClipPath(), aPathMatrix, aTransform);

    if (aClipPolyPoly.count())
    {
        // Clip against ClipRegion, use same conversions and transformation on
        // the graphic bounds as were applied to the clipping polypolygon
        const tools::Rectangle aRect = PointsToLogic(aBounds.getMinX(), aBounds.getMaxX(),
                                                     aBounds.getMinY(), aBounds.getMaxY());
        basegfx::B2DPolyPolygon aGraphicBounds(
            basegfx::utils::createPolygonFromRect(vcl::unotools::b2DRectangleFromRectangle(aRect)));
        aGraphicBounds.transform(aTransform);
        const basegfx::B2DPolyPolygon aClippedBounds(basegfx::utils::clipPolyPolygonOnPolyPolygon(
            aGraphicBounds, aClipPolyPoly, true, false));
        // completely clipped out
        bEntirelyClippedOut = aClippedBounds.getB2DRange().isEmpty();
    }

    tools::Rectangle aRect = PointsToLogic(left, right, top, bottom);
    aRect.AdjustRight(1);
    aRect.AdjustBottom(1);

    rtl::Reference<SdrGrafObj> pGraf = new SdrGrafObj(*mpModel, aGraphic, aRect);

    // This action is not creating line and fill, set directly, do not use SetAttributes(..)
    pGraf->SetMergedItem(XLineStyleItem(drawing::LineStyle_NONE));
    pGraf->SetMergedItem(XFillStyleItem(drawing::FillStyle_NONE));

    if (bEntirelyClippedOut)
        pGraf->SetVisible(false);

    pGraf->AppendUserData(std::move(pProvenance));

    InsertObj(pGraf.get());
}

void ImpSdrPdfImport::appendSegmentsToPolyPoly(
    basegfx::B2DPolyPolygon& rPolyPoly,
    const std::vector<std::unique_ptr<vcl::pdf::PDFiumPathSegment>>& rPathSegments,
    const basegfx::B2DHomMatrix& rPathMatrix)
{
    basegfx::B2DPolygon aPoly;
    std::vector<basegfx::B2DPoint> aBezier;

    for (const auto& pPathSegment : rPathSegments)
    {
        if (pPathSegment != nullptr)
        {
            basegfx::B2DPoint aB2DPoint = pPathSegment->getPoint();
            aB2DPoint *= rPathMatrix;

            const bool bClose = pPathSegment->isClosed();
            if (bClose)
                aPoly.setClosed(bClose); // TODO: Review

            Point aPoint = PointsToLogic(aB2DPoint.getX(), aB2DPoint.getY());
            aB2DPoint.setX(aPoint.X());
            aB2DPoint.setY(aPoint.Y());

            const vcl::pdf::PDFSegmentType eSegmentType = pPathSegment->getType();
            switch (eSegmentType)
            {
                case vcl::pdf::PDFSegmentType::Lineto:
                    aPoly.append(aB2DPoint);
                    break;

                case vcl::pdf::PDFSegmentType::Bezierto:
                    aBezier.emplace_back(aB2DPoint.getX(), aB2DPoint.getY());
                    if (aBezier.size() == 3)
                    {
                        aPoly.appendBezierSegment(aBezier[0], aBezier[1], aBezier[2]);
                        aBezier.clear();
                    }
                    break;

                case vcl::pdf::PDFSegmentType::Moveto:
                    // New Poly.
                    if (aPoly.count() > 0)
                    {
                        rPolyPoly.append(aPoly, 1);
                        aPoly.clear();
                    }

                    aPoly.append(aB2DPoint);
                    break;

                case vcl::pdf::PDFSegmentType::Unknown:
                default:
                    SAL_WARN("sd.filter", "Unknown path segment type in PDF: "
                                              << static_cast<int>(eSegmentType));
                    break;
            }
        }
    }

    if (aBezier.size() == 3)
    {
        aPoly.appendBezierSegment(aBezier[0], aBezier[1], aBezier[2]);
        aBezier.clear();
    }

    if (aPoly.count() > 0)
    {
        rPolyPoly.append(aPoly, 1);
        aPoly.clear();
    }
}

void ImpSdrPdfImport::ImportPath(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                                 std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage,
                                 int /*nPageObjectIndex*/)
{
    auto aPathMatrix = pPageObject->getMatrix();

    aPathMatrix *= maCurrentMatrix;

    basegfx::B2DPolyPolygon aPolyPoly;

    std::vector<std::unique_ptr<vcl::pdf::PDFiumPathSegment>> aPathSegments;
    const int nSegments = pPageObject->getPathSegmentCount();
    for (int nSegmentIndex = 0; nSegmentIndex < nSegments; ++nSegmentIndex)
    {
        aPathSegments.push_back(pPageObject->getPathSegment(nSegmentIndex));
    }

    appendSegmentsToPolyPoly(aPolyPoly, aPathSegments, aPathMatrix);

    const basegfx::B2DHomMatrix aTransform(
        basegfx::utils::createScaleTranslateB2DHomMatrix(mfScaleX, mfScaleY, maOfs.X(), maOfs.Y()));
    aPolyPoly.transform(aTransform);

    float fWidth = pPageObject->getStrokeWidth();
    const double dWidth = 0.5 * fabs(std::hypot(aPathMatrix.a(), aPathMatrix.c()) * fWidth);
    mnLineWidth = convertPointToMm100(dWidth);

    // The pdf spec recommends drawing a sub-pixel stroke as a hairline.
    // For us a hairline is used with a line width of 0
    const sal_Int32 nOnePixel = mpVD->PixelToLogic(Size(1, 1)).Width();
    if (mnLineWidth > 0 && mnLineWidth < nOnePixel)
        mnLineWidth = 0;

    vcl::pdf::PDFFillMode nFillMode = vcl::pdf::PDFFillMode::Alternate;
    bool bStroke = true; // Assume we have to draw, unless told otherwise.
    if (pPageObject->getDrawMode(nFillMode, bStroke))
    {
        if (nFillMode == vcl::pdf::PDFFillMode::Alternate)
            mpVD->SetDrawMode(DrawModeFlags::Default);
        else if (nFillMode == vcl::pdf::PDFFillMode::Winding)
            mpVD->SetDrawMode(DrawModeFlags::Default);
        else
            mpVD->SetDrawMode(DrawModeFlags::NoFill);
    }

    if (std::unique_ptr<vcl::pdf::PDFiumBitmap> bitmap
        = pPageObject->getRenderedFillPattern(*mpPdfDocument, *pPage))
    {
        moFillPattern = bitmap->createBitmapFromBuffer();
        moFillColor.reset();
    }
    else
    {
        moFillColor = pPageObject->getFillColor();
        moFillPattern.reset();
    }

    if (bStroke)
        mpVD->SetLineColor(getStrokeColor(pPageObject, pPage));
    else
        mpVD->SetLineColor(COL_TRANSPARENT);

    if (!mbLastObjWasPolyWithoutLine || !CheckLastPolyLineAndFillMerge(aPolyPoly))
    {
        rtl::Reference<SdrPathObj> pPath
            = new SdrPathObj(*mpModel, SdrObjKind::Polygon, std::move(aPolyPoly));
        SetAttributes(pPath.get());
        InsertObj(pPath.get(), false);
    }
}

Point ImpSdrPdfImport::PointsToLogic(double x, double y) const
{
    y = correctVertOrigin(y);

    Point aPos(convertPointToMm100(x), convertPointToMm100(y));
    return aPos;
}

tools::Rectangle ImpSdrPdfImport::PointsToLogic(double left, double right, double top,
                                                double bottom) const
{
    top = correctVertOrigin(top);
    bottom = correctVertOrigin(bottom);

    Point aPos(convertPointToMm100(left), convertPointToMm100(top));
    Size aSize(convertPointToMm100(right - left), convertPointToMm100(bottom - top));

    return tools::Rectangle(aPos, aSize);
}


// ── The page's text as pdfium reads it (svx/svdpdfrawtext.hxx) ─────────────
namespace svx::pdf
{
namespace
{
struct RawChar
{
    sal_uInt32 nUnicode;
    double fLeft, fRight, fBottom, fTop; // loose box, pt, y up; all 0 for a generated space
    double fOx, fOy; // origin
};

void lcl_ReadTextObject(vcl::pdf::PDFiumPageObject& rObject, const basegfx::B2DHomMatrix& rCtm,
                        const std::map<void*, std::vector<RawChar>>& rChars,
                        const ImportedFontMap* pFonts, double fPageHeight,
                        std::vector<RawTextRun>& rOut)
{
    const auto eType = rObject.getType();
    if (eType == vcl::pdf::PDFPageObjectType::Form)
    {
        const basegfx::B2DHomMatrix aMatrix = rCtm * rObject.getMatrix();
        const int nCount = rObject.getFormObjectCount();
        for (int i = 0; i < nCount; ++i)
        {
            auto pChild = rObject.getFormObject(i);
            if (pChild)
                lcl_ReadTextObject(*pChild, aMatrix, rChars, pFonts, fPageHeight, rOut);
        }
        return;
    }
    if (eType != vcl::pdf::PDFPageObjectType::Text)
        return;
    // Invisible text (render mode 3 — an OCR layer under a scan) draws
    // nothing, so it is not a run of the page. The importer skips it the
    // same way (ImportText's bInvisible).
    if (rObject.getTextRenderMode() == vcl::pdf::PDFTextRenderMode::Invisible)
        return;
    auto it = rChars.find(rObject.getPointer());
    if (it == rChars.end())
        return;
    OUStringBuffer aText;
    double fLeft = std::numeric_limits<double>::max();
    double fRight = std::numeric_limits<double>::lowest();
    double fLoose = 0.0, fOy = 0.0;
    bool bReal = false;
    for (const RawChar& rChar : it->second)
    {
        aText.appendUtf32(rChar.nUnicode);
        if (rChar.fRight <= rChar.fLeft)
            continue; // a generated space
        if (!bReal)
            fOy = rChar.fOy;
        bReal = true;
        fLeft = std::min(fLeft, rChar.fLeft);
        fRight = std::max(fRight, rChar.fRight);
        fLoose = std::max(fLoose, rChar.fTop - rChar.fBottom);
    }
    if (!bReal || aText.isEmpty())
        return;
    const basegfx::B2DHomMatrix aMatrix = rCtm * rObject.getMatrix();
    RawTextRun aRun;
    aRun.sText = aText.makeStringAndClear();
    aRun.fX = fLeft;
    aRun.fRight = fRight;
    aRun.fBaseline = fPageHeight - fOy;
    // the size from the object and its matrix; a glyph nested in a scaled
    // form can carry the form's scale twice, so the loose box (ascent +
    // descent, about 1.2 em) is the check
    aRun.fSize = std::abs(rObject.getFontSize() * std::hypot(aMatrix.b(), aMatrix.d()));
    if (fLoose > 0.0 && (aRun.fSize > 1.6 * fLoose || aRun.fSize < 0.5 * fLoose / 1.4))
        aRun.fSize = fLoose / 1.2;
    if (aRun.fSize <= 0.0)
        aRun.fSize = 1.0;
    aRun.fAngle = -basegfx::rad2deg(std::atan2(aMatrix.b(), aMatrix.a()));
    // the face as the importer names it
    OUString sFamily;
    FontWeight eWeight = WEIGHT_DONTKNOW;
    bool bNameItalic = false;
    auto xFont = rObject.getFont();
    if (pFonts && xFont)
    {
        auto itFont = pFonts->find(xFont->getFontDictObjNum());
        if (itFont != pFonts->end())
        {
            sFamily = itFont->sFontName;
            eWeight = itFont->eFontWeight;
        }
    }
    if (sFamily.isEmpty())
    {
        sFamily = rObject.getFontName();
        lcl_StandardFontFamily(sFamily, sFamily, eWeight, bNameItalic);
    }
    aRun.sFamily = sFamily;
    aRun.eWeight = eWeight == WEIGHT_DONTKNOW ? WEIGHT_NORMAL : eWeight;
    aRun.bItalic = bNameItalic || rObject.getFontAngle() != 0;
    Color aColor = rObject.getFillColor();
    if (aColor == COL_TRANSPARENT)
        aColor = rObject.getStrokeColor();
    aRun.aColor = aColor == COL_TRANSPARENT ? COL_BLACK : aColor.GetRGBColor();
    rOut.push_back(std::move(aRun));
}
}

std::vector<RawTextRun> ReadPdfPageRawText(const Graphic& rGraphic, const ImportedFontMap* pFonts)
{
    std::vector<RawTextRun> aOut;
    auto const& pVectorGraphicData = rGraphic.getVectorGraphicData();
    if (!pVectorGraphicData || pVectorGraphicData->getType() != VectorGraphicDataType::Pdf)
        return aOut;
    auto pPdfium = vcl::pdf::PDFiumLibrary::get();
    if (!pPdfium)
        return aOut;
    const auto* pData = pVectorGraphicData->getBinaryDataContainer().getData();
    const sal_Int32 nSize = pVectorGraphicData->getBinaryDataContainer().getSize();
    auto pDocument = pPdfium->openDocument(pData, nSize, OString());
    if (!pDocument)
        return aOut;
    const int nPageIndex = rGraphic.getPageNumber();
    if (nPageIndex < 0 || nPageIndex >= pDocument->getPageCount())
        return aOut;
    auto pPage = pDocument->openPage(nPageIndex);
    if (!pPage)
        return aOut;
    auto pTextPage = pPage->getTextPage();
    if (!pTextPage)
        return aOut;
    const double fPageHeight = pPage->getHeight();
    // chars by the object that drew them, in reading order
    std::map<void*, std::vector<RawChar>> aChars;
    void* pPrev = nullptr;
    const int nChars = pTextPage->countChars();
    for (int i = 0; i < nChars; ++i)
    {
        void* pObject = pTextPage->getTextObjectPointer(i);
        const sal_uInt32 nUnicode = pTextPage->getUnicode(i);
        if (!pObject)
        {
            // a space pdfium generated from a gap: a trailing space on the
            // glyph before it, the way the importer reads it
            if (pPrev && (nUnicode == 32 || nUnicode == 160))
                aChars[pPrev].push_back({ 32, 0, 0, 0, 0, 0, 0 });
            continue;
        }
        if (nUnicode == 0 || nUnicode == 13 || nUnicode == 10)
            continue;
        pPrev = pObject;
        RawChar aChar{ nUnicode, 0, 0, 0, 0, 0, 0 };
        if (!pTextPage->getLooseCharBox(i, aChar.fLeft, aChar.fRight, aChar.fBottom, aChar.fTop))
            aChar.fLeft = aChar.fRight = aChar.fBottom = aChar.fTop = 0.0;
        pTextPage->getCharOrigin(i, aChar.fOx, aChar.fOy);
        aChars[pObject].push_back(aChar);
    }
    const int nObjects = pPage->getObjectCount();
    for (int i = 0; i < nObjects; ++i)
    {
        auto pObject = pPage->getObject(i);
        if (pObject)
            lcl_ReadTextObject(*pObject, basegfx::B2DHomMatrix(), aChars, pFonts, fPageHeight, aOut);
    }
    return aOut;
}
}

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
