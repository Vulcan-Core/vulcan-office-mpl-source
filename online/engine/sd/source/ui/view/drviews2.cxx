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

#include <set>
#include <vcl/filter/embedfontinfo.hxx>
#include <cstdlib>
#include <cctype>
#include <config_features.h>

#include <avmedia/mediaplayer.hxx>

#include <basic/sberrors.hxx>
#include <basic/sbstar.hxx>

#include <com/sun/star/drawing/XMasterPagesSupplier.hpp>
#include <com/sun/star/drawing/XDrawPages.hpp>
#include <com/sun/star/lang/XInitialization.hpp>
#include <com/sun/star/ui/dialogs/XExecutableDialog.hpp>
#include <com/sun/star/ui/dialogs/XSLTFilterDialog.hpp>
#include <com/sun/star/frame/XDispatchProvider.hpp>
#include <com/sun/star/util/URLTransformer.hpp>
#include <com/sun/star/util/XURLTransformer.hpp>
#include <com/sun/star/scanner/XScannerManager2.hpp>
#include <com/sun/star/document/XDocumentProperties.hpp>

#include <comphelper/processfactory.hxx>
#include <comphelper/propertysequence.hxx>
#include <comphelper/scopeguard.hxx>
#include <comphelper/kit.hxx>
#include <comphelper/sequence.hxx>
#include <comphelper/sequenceashashmap.hxx>
#include <comphelper/dispatchcommand.hxx>
#include <comphelper/propertyvalue.hxx>

#include <editeng/contouritem.hxx>
#include <editeng/editdata.hxx>
#include <editeng/eeitem.hxx>
#include <editeng/editdata.hxx>
#include <svl/itemiter.hxx>
#include <functional>
#include <editeng/ulspitem.hxx>
#include <vcl/metric.hxx>
#include <editeng/flditem.hxx>
#include <editeng/section.hxx>
#include <editeng/editobj.hxx>
#include <editeng/CustomPropertyField.hxx>
#include <editeng/urlfieldhelper.hxx>

#include <sal/log.hxx>

#include <sfx2/bindings.hxx>
#include <sfx2/dispatch.hxx>
#include <sfx2/docfile.hxx>
#include <sfx2/msgpool.hxx>
#include <sfx2/msg.hxx>
#include <sfx2/request.hxx>
#include <sfx2/viewfrm.hxx>
#include <sfx2/zoomitem.hxx>
#include <sfx2/kit/helper.hxx>
#include <sfx2/kit/unocommandlist.hxx>

#include <svx/compressgraphicdialog.hxx>
#include <svx/ClassificationDialog.hxx>
#include <svx/ClassificationCommon.hxx>
#include <svx/bmpmask.hxx>
#include <svx/extedit.hxx>
#include <svx/extrusionbar.hxx>
#include <svx/f3dchild.hxx>
#include <svx/fontwork.hxx>
#include <svx/fontworkbar.hxx>
#include <svx/graphichelper.hxx>
#include <svx/hlnkitem.hxx>
#include <svx/imapdlg.hxx>
#include <svx/sderitm.hxx>
#include <svx/sdtagitm.hxx>
#include <svx/sdtaitm.hxx>
#include <svx/sdtditm.hxx>
#include <svx/sdtmfitm.hxx>
#include <svx/svdetc.hxx>
#include <svx/svdograf.hxx>
#include <svx/svdoole2.hxx>
#include <svx/svdocirc.hxx>
#include <svx/svdorect.hxx>
#include <svx/svdpagv.hxx>
#include <svx/svdundo.hxx>
#include <svx/svxdlg.hxx>
#include <svx/svxids.hrc>
#include <svx/sdtfsitm.hxx>
#include <svx/sdmetitm.hxx>
#include <svx/zoomslideritem.hxx>
#include <svx/xflclit.hxx>
#include <svx/svdouno.hxx>
#include <svx/svdobjkind.hxx>
#include <com/sun/star/beans/XPropertySet.hpp>
#include <cpo/uno/Any.hxx>
#include <svx/xlnwtit.hxx>
#include <svx/chrtitem.hxx>
#include <svx/xlnclit.hxx>
#include <svx/xflgrit.hxx>
#include <svx/xfillit0.hxx>
#include <svx/xlineit0.hxx>

#include <comphelper/diagnose_ex.hxx>
#include <tools/json_writer.hxx>
#include <tools/UnitConversion.hxx>

#include <unotools/useroptions.hxx>

#include <vcl/abstdlg.hxx>
#include <vcl/graph.hxx>
#include <vcl/graphicfilter.hxx>
#include <vcl/svapp.hxx>
#include <vcl/outdev.hxx>
#include <vcl/embeddedfontsmanager.hxx>
#include <comphelper/base64.hxx>
#include <cpo/uno/Sequence.hxx>
#include <osl/file.hxx>
#include <vcl/unohelp2.hxx>
#include <vcl/weld.hxx>

#include <editeng/cmapitem.hxx>
#include <editeng/escapementitem.hxx>
#include <editeng/kernitem.hxx>
#include <editeng/wghtitem.hxx>
#include <editeng/postitem.hxx>
#include <editeng/udlnitem.hxx>
#include <editeng/crossedoutitem.hxx>
#include <editeng/shdditem.hxx>
#include <editeng/numitem.hxx>
#include <svx/svdobj.hxx>
#include <svx/SvxColorChildWindow.hxx>
#include <editeng/outlobj.hxx>
#include <editeng/flstitem.hxx>
#include <editeng/fontitem.hxx>
#include <editeng/fhgtitem.hxx>
#include <editeng/colritem.hxx>

#include <svl/poolitem.hxx>
#include <svl/style.hxx>
#include <svl/whiter.hxx>

#include <app.hrc>
#include <strings.hrc>
#include <unmodpg.hxx>
#include <unokywds.hxx>
#include <svx/svdlayer.hxx>

#include <AnimationChildWindow.hxx>
#include <DrawDocShell.hxx>
#include <DrawViewShell.hxx>
#include <LayerTabBar.hxx>
#include <Outliner.hxx>
#include <VulcanPdfPageModel.hxx>
#include <ViewShellHint.hxx>
#include <ViewShellImplementation.hxx>
#include <Window.hxx>
#include <drawdoc.hxx>
#include <SlideSectionManager.hxx>
#include <UndoSlideSection.hxx>
#include <drawview.hxx>
#include <fuarea.hxx>
#include <fubullet.hxx>
#include <fuchar.hxx>
#include <fucushow.hxx>
#include <fuconnct.hxx>
#include <fucopy.hxx>
#include <fudspord.hxx>
#include <fuexecuteinteraction.hxx>
#include <fuexpand.hxx>
#include <fuinsert.hxx>
#include <fuinsfil.hxx>
#include <fuline.hxx>
#include <fulinend.hxx>
#include <fulink.hxx>
#include <fumeasur.hxx>
#include <fumorph.hxx>
#include <fuoaprms.hxx>
#include <fuolbull.hxx>
#include <fupage.hxx>
#include <fuparagr.hxx>
#include <fuprlout.hxx>
#include <fuscale.hxx>
#include <fusel.hxx>
#include <fusldlg.hxx>
#include <fusnapln.hxx>
#include <fusumry.hxx>
#include <futempl.hxx>
#include <futhes.hxx>
#include <futransf.hxx>
#include <futxtatt.hxx>
#include <fuvect.hxx>
#include <futext.hxx>
#include <helpids.h>
#include <sdabstdlg.hxx>
#include <sdattr.hxx>
#include <sdpage.hxx>
#include <sdresid.hxx>
#include <unokywds.hxx>
#include <slideshow.hxx>
#include <stlsheet.hxx>
#include <undolayer.hxx>
#include <sfx2/sidebar/Sidebar.hxx>
#include <sfx2/classificationhelper.hxx>
#include <sdmod.hxx>
#include <model/SlsPageDescriptor.hxx>
#include <model/SlsPageEnumerationProvider.hxx>
#include <SlideSorter.hxx>
#include <view/SlideSorterView.hxx>
#include <SlideSorterViewShell.hxx>
#include <controller/SlideSorterController.hxx>
#include <controller/SlsPageSelector.hxx>
#include <controller/SlsClipboard.hxx>
#include <tools/GraphicSizeCheck.hxx>

#include <theme/ThemeColorChanger.hxx>
#include <svx/dialog/ThemeDialog.hxx>
#include <svx/dialog/ThemeColorEditDialog.hxx>
#include <svx/ColorSets.hxx>
#include <COKit/COKitEnums.h>

#include <ViewShellBase.hxx>
#include <memory>
#include <stdexcept>
#include <string_view>

#include <sfx2/newstyle.hxx>
#include <SelectLayerDlg.hxx>
#include <unomodel.hxx>

#include <iostream>
#include <sstream>
#include <vector>
#include <algorithm>
#include <boost/property_tree/json_parser.hpp>
#include <rtl/uri.hxx>
#include <editeng/editeng.hxx>


using namespace ::com::sun::star;
using namespace ::com::sun::star::uno;
using namespace cpo::uno;

#define MIN_ACTIONS_FOR_DIALOG  5000    ///< if there are more meta objects, we show a dialog during the break up

namespace sd {

namespace {

const SvxFieldItem* findField(editeng::Section const & rSection)
{
    for (SfxPoolItem const * pPool: rSection.maAttributes)
    {
        if (pPool->Which() == EE_FEATURE_FIELD)
            return static_cast<const SvxFieldItem*>(pPool);
    }
    return nullptr;
}

bool hasCustomPropertyField(std::vector<editeng::Section> const & aSections, std::u16string_view rName)
{
    for (editeng::Section const & rSection : aSections)
    {
        const SvxFieldItem* pFieldItem = findField(rSection);
        if (pFieldItem)
        {
            const editeng::CustomPropertyField* pCustomPropertyField = dynamic_cast<const editeng::CustomPropertyField*>(pFieldItem->GetField());
            if (pCustomPropertyField && pCustomPropertyField->GetName() == rName)
                return true;
        }
    }
    return false;
}

OUString getWeightString(SfxItemSet const & rItemSet)
{
    OUString sWeightString = u"NORMAL"_ustr;

    if (const SfxPoolItem* pItem = rItemSet.GetItem(EE_CHAR_WEIGHT, false))
    {
        const SvxWeightItem* pWeightItem = dynamic_cast<const SvxWeightItem*>(pItem);
        if (pWeightItem && pWeightItem->GetWeight() == WEIGHT_BOLD)
            sWeightString = u"BOLD"_ustr;
    }
    return sWeightString;
}

class TransformWarningCollector
{
    std::vector<std::string> maWarnings;
    static inline TransformWarningCollector* gpCurrent = nullptr;
public:
    TransformWarningCollector() { gpCurrent = this; }
    ~TransformWarningCollector() { gpCurrent = nullptr; }
    static void add(const std::string& rWarning)
    {
        if (gpCurrent)
            gpCurrent->maWarnings.push_back(rWarning);
    }
    const std::vector<std::string>& getWarnings() const { return maWarnings; }
};

void lcl_LogWarning(const std::string& rWarning)
{
    KIT_WARN("sd.transform", rWarning);
    TransformWarningCollector::add(rWarning);
}

void lcl_UnoCommand(const std::string& rText)
{
    if (rText.size() > 0)
    {
        OUString aCmd;
        std::vector<beans::PropertyValue> aArg;
        std::size_t nSpace = rText.find(' ');
        if (nSpace != std::string::npos)
        {
            aCmd = OStringToOUString(rText.substr(0, nSpace), RTL_TEXTENCODING_UTF8);
            std::string aArgText = rText.substr(nSpace + 1);

            aArg = comphelper::JsonToPropertyValues(aArgText);
        }
        else
        {
            aCmd = OStringToOUString(rText, RTL_TEXTENCODING_UTF8);
        }

        OUString aCmdSub;
        if (aCmd.startsWith(".uno:"))
        {
            aCmdSub = aCmd.subView(5);
        }
        else
        {
            lcl_LogWarning("FillApi SlideCmd: uno command not recognized'" + rText + "'");
            return;
        }

        // Check if the uno command is allowed
        const std::map<std::u16string_view, KitUnoCommand>& rUnoCommandList
            = GetKitUnoCommandList();
        auto aCmdData = rUnoCommandList.find(aCmdSub);
        if (aCmdData != rUnoCommandList.end())
        {
            // Make the uno command synchron
            aArg.push_back(comphelper::makePropertyValue(u"SynchronMode"_ustr, true));

            // Todo: check why it does not work on my windows system
            comphelper::dispatchCommand(aCmd, comphelper::containerToSequence(aArg));
        }
        else
        {
            lcl_LogWarning("FillApi SlideCmd: uno command not recognized'" + rText + "'");
        }
    }
}

// Parses a 6-digit lowercase hex RGB value ("1a2b3c") into an opaque Color.
// Anything else - wrong length, uppercase, non-hex - is rejected.
bool lcl_ParseHexColor(const std::string& rText, Color& rColor)
{
    if (rText.size() != 6)
        return false;
    sal_uInt32 nValue = 0;
    for (const char c : rText)
    {
        nValue <<= 4;
        if (c >= '0' && c <= '9')
            nValue += c - '0';
        else if (c >= 'a' && c <= 'f')
            nValue += c - 'a' + 10;
        else
            return false;
    }
    // The sal_uInt32 Color constructor is consteval; build from channels.
    rColor = Color(static_cast<sal_uInt8>(nValue >> 16),
                   static_cast<sal_uInt8>(nValue >> 8),
                   static_cast<sal_uInt8>(nValue));
    return true;
}

// Fit means HUG (Vulcan fork): strip the spacing a generator hid at the
// text's outer edges — space-above on the FIRST paragraph and space-below
// on the LAST — so FitFrameToTextSize computes the text, not text plus
// invisible padding ("still has padding in the title text at the top
// despite ctrl shift f"). Spacing BETWEEN paragraphs is authored rhythm
// and stays. Callers record CreateUndoObjectSetText first.
void lcl_StripOuterParaSpacing(SdDrawDocument* pDoc, SdrTextObj* pTextObj)
{
    SdOutliner* pOutl = pDoc ? pDoc->GetInternalOutliner() : nullptr;
    OutlinerParaObject* pOPO = pTextObj ? pTextObj->GetOutlinerParaObject() : nullptr;
    if (!pOutl || !pOPO)
        return;
    pOutl->SetText(*pOPO);
    const sal_Int32 nParas = pOutl->GetParagraphCount();
    bool bChanged = false;
    if (nParas > 0)
    {
        SfxItemSet aFirst(pOutl->GetParaAttribs(0));
        SvxULSpaceItem aFirstUL(aFirst.Get(EE_PARA_ULSPACE));
        if (aFirstUL.GetUpper() != 0)
        {
            aFirstUL.SetUpper(0);
            aFirst.Put(aFirstUL);
            pOutl->SetParaAttribs(0, aFirst);
            bChanged = true;
        }
        SfxItemSet aLast(pOutl->GetParaAttribs(nParas - 1));
        SvxULSpaceItem aLastUL(aLast.Get(EE_PARA_ULSPACE));
        if (aLastUL.GetLower() != 0)
        {
            aLastUL.SetLower(0);
            aLast.Put(aLastUL);
            pOutl->SetParaAttribs(nParas - 1, aLast);
            bChanged = true;
        }
        if (bChanged)
            pTextObj->SetOutlinerParaObject(pOutl->CreateParaObject());
    }
    pOutl->Clear();
}

// The ONE frame-to-text hug, shared by every fit path (the FillApi
// FitFrameToText verb and SID_FIT_FRAME_TO_TEXT): text-content undo,
// outer paragraph-spacing strip, vertical inset zeroing, geometry undo,
// then the fit itself. rAddUndo abstracts the caller's undo recorder so
// the sequence cannot drift between the two sites.
void lcl_FitFrameHug(SdDrawDocument* pDoc, SdrTextObj* pTextObj,
                     const std::function<void(std::unique_ptr<SdrUndoAction>)>& rAddUndo)
{
    // Geometry undo is recorded FIRST because undo replays in reverse:
    // the attr and text restores below re-fire autogrow adjustment on
    // the way back, so the rect must be the LAST thing restored or a
    // single undo leaves the box re-shrunk to its text (the toggle
    // block plays the same trick).
    rAddUndo(pDoc->GetSdrUndoFactory().CreateUndoGeoObject(*pTextObj));
    rAddUndo(pDoc->GetSdrUndoFactory().CreateUndoObjectSetText(*pTextObj, 0));
    lcl_StripOuterParaSpacing(pDoc, pTextObj);
    // INK-MEASURED top trim: the fit's frame top must land on the
    // first line's tallest DRAWN pixel the way the sides land on glyph
    // edges — not on the line box, which reserves ascent slack above
    // the caps ("what is it going to take to get this content fit
    // right"). GetTextBoundRect measures the exact ink of the first
    // paragraph's own text in its own font, so an accented capital in
    // THIS title raises the measured ink and shrinks the trim by
    // itself — accent-safe by measurement, not by guesswork. Falls
    // back to the font's internal leading when the ink measurement is
    // unavailable (empty text, degenerate device).
    tools::Long nTopTrim = 0;
    if (SdOutliner* pMetricOutl = pDoc->GetInternalOutliner())
    {
        if (OutputDevice* pRef = pMetricOutl->GetRefDevice())
        {
            EditEngine& rEE
                = const_cast<EditEngine&>(pMetricOutl->GetEditEngine());
            if (OutlinerParaObject* pOPO = pTextObj->GetOutlinerParaObject())
            {
                pMetricOutl->SetText(*pOPO);
                vcl::Font aFirstFont = rEE.GetStandardFont(0);
                const OUString aFirstText = rEE.GetText(0);
                pRef->Push(vcl::PushFlags::FONT);
                pRef->SetFont(aFirstFont);
                tools::Rectangle aInk;
                if (!aFirstText.isEmpty()
                    && pRef->GetTextBoundRect(aInk, aFirstText)
                    && !aInk.IsEmpty() && aInk.Top() > 0)
                {
                    // DrawText's origin is the top-left of the text
                    // cell, so the ink rect's Top IS the cell-top to
                    // ink-top gap.
                    nTopTrim = aInk.Top();
                }
                else
                {
                    const FontMetric aMetric(pRef->GetFontMetric());
                    if (aMetric.GetInternalLeading() > 0)
                        nTopTrim = aMetric.GetInternalLeading();
                }
                pRef->Pop();
                pMetricOutl->Clear();
            }
        }
    }
    rAddUndo(pDoc->GetSdrUndoFactory().CreateUndoAttrObject(*pTextObj));
    pTextObj->SetMergedItem(makeSdrTextUpperDistItem(-nTopTrim));
    pTextObj->SetMergedItem(makeSdrTextLowerDistItem(0));
    pTextObj->FitFrameToTextSize();
    // "When I start typing the box should expand to fit the new amount
    // of text": the hug leaves the box ARMED to keep hugging — autogrow
    // height on, its floor zeroed AFTER the flip (enabling the mode
    // reseeds the minimum from the current rect, which the zero must
    // outlive), and a conflicting shrink-autofit cleared. Width stays
    // as authored: it is the wrap width.
    if (pTextObj->GetMergedItemSet()
            .GetItem<SdrTextFitToSizeTypeItem>(SDRATTR_TEXT_FITTOSIZE)
            ->GetValue()
        != drawing::TextFitToSizeType_NONE)
        pTextObj->SetMergedItem(
            SdrTextFitToSizeTypeItem(drawing::TextFitToSizeType_NONE));
    pTextObj->SetMergedItem(makeSdrTextAutoGrowHeightItem(true));
    pTextObj->SetMergedItem(makeSdrTextMinFrameHeightItem(0));
}

// Parses one optional trailing style token of the insert commands' value
// grammar (Slide Studio library styling): "s<pt>" font size in points,
// "b" bold, "c<6hex>" text color. Returns false for anything else.
bool lcl_ParseInsertStyleToken(const std::string& rToken, sal_Int32& rSizePt, bool& rBold,
                               bool& rHasColor, Color& rColor)
{
    if (rToken == "b")
    {
        rBold = true;
        return true;
    }
    if (rToken.size() >= 2 && rToken[0] == 's'
        && rToken.find_first_not_of("0123456789", 1) == std::string::npos)
    {
        try
        {
            const int nSize = stoi(rToken.substr(1));
            if (nSize <= 0 || nSize > 999)
                return false;
            rSizePt = nSize;
            return true;
        }
        catch (const std::exception&)
        {
            return false;
        }
    }
    if (rToken.size() == 7 && rToken[0] == 'c')
    {
        Color aColor;
        if (!lcl_ParseHexColor(rToken.substr(1), aColor))
            return false;
        rColor = aColor;
        rHasColor = true;
        return true;
    }
    return false;
}

// EE_CHAR_FONTHEIGHT rides the drawing pool's 1/100 mm metric: pt to
// 1/100 mm is *2540/72.
void lcl_PutInsertStyleItems(SfxItemSet& rSet, sal_Int32 nSizePt, bool bBold, bool bHasColor,
                             const Color& rColor)
{
    if (nSizePt > 0)
        rSet.Put(SvxFontHeightItem(nSizePt * 2540 / 72, 100, EE_CHAR_FONTHEIGHT));
    if (bBold)
        rSet.Put(SvxWeightItem(WEIGHT_BOLD, EE_CHAR_WEIGHT));
    if (bHasColor)
        rSet.Put(SvxColorItem(rColor, EE_CHAR_COLOR));
}

bool lcl_ReplaceWithImage(SdDrawDocument* pDoc, SdPage* pPage, int nObjId,
                                 const std::string& rImageUrl,
                                 SfxViewShell* pViewShell, int nPartId)
{
    OUString aURL = OStringToOUString(rImageUrl, RTL_TEXTENCODING_UTF8);

    Graphic aGraphic;
    ErrCode nError = GraphicFilter::LoadGraphic(
        aURL, OUString(), aGraphic, &GraphicFilter::GetGraphicFilter());
    if (nError != ERRCODE_NONE)
    {
        lcl_LogWarning("FillApi SlideCmd: Failed to load graphic from '" + rImageUrl + "'");
        return false;
    }

    SdrObject* pPickObj = pPage->GetObj(nObjId);
    rtl::Reference<SdrGrafObj> pNewGrafObj
        = new SdrGrafObj(*pDoc, aGraphic, pPickObj->GetLogicRect());
    pNewGrafObj->AdjustToMaxRect(pPickObj->GetLogicRect());
    pNewGrafObj->SetOutlinerParaObject(std::nullopt);
    pNewGrafObj->SetEmptyPresObj(false);

    pPage->ReplaceObject(pNewGrafObj.get(), pPickObj->GetOrdNum());

    KitHelper::notifyInvalidation(pViewShell, nPartId, nullptr);
    return true;
}

class ClassificationCommon
{
protected:
    sd::DrawViewShell& m_rDrawViewShell;
    uno::Reference<document::XDocumentProperties> m_xDocumentProperties;
    uno::Reference<beans::XPropertyContainer> m_xPropertyContainer;
    sfx::ClassificationKeyCreator m_aKeyCreator;
public:
    ClassificationCommon(sd::DrawViewShell& rDrawViewShell, const css::uno::Reference<css::document::XDocumentProperties>& rDocProps)
        : m_rDrawViewShell(rDrawViewShell)
        , m_xDocumentProperties(rDocProps)
        , m_xPropertyContainer(m_xDocumentProperties->getUserDefinedProperties())
        , m_aKeyCreator(SfxClassificationHelper::getPolicyType())
    {}
};

class ClassificationCollector : public ClassificationCommon
{
private:
    std::vector<svx::ClassificationResult> m_aResults;

    void iterateSectionsAndCollect(std::vector<editeng::Section> const & rSections, EditTextObject const & rEditText)
    {
        sal_Int32 nCurrentParagraph = -1;
        OUString sBlank;

        for (editeng::Section const & rSection : rSections)
        {
            // Insert new paragraph if needed
            while (nCurrentParagraph < rSection.mnParagraph)
            {
                nCurrentParagraph++;
                // Get Weight of current paragraph
                OUString sWeightProperty = getWeightString(rEditText.GetParaAttribs(nCurrentParagraph));
                // Insert new paragraph into collection
                m_aResults.emplace_back(svx::ClassificationType::PARAGRAPH, sWeightProperty, sBlank, sBlank);
            }

            const SvxFieldItem* pFieldItem = findField(rSection);
            const editeng::CustomPropertyField* pCustomPropertyField = pFieldItem ?
                dynamic_cast<const editeng::CustomPropertyField*>(pFieldItem->GetField()) :
                nullptr;
            if (pCustomPropertyField)
            {
                const OUString& aKey = pCustomPropertyField->GetName();
                if (m_aKeyCreator.isMarkingTextKey(aKey))
                {
                    m_aResults.emplace_back(svx::ClassificationType::TEXT,
                                           svx::classification::getProperty(m_xPropertyContainer, aKey),
                                           sBlank, sBlank);
                }
                else if (m_aKeyCreator.isCategoryNameKey(aKey) || m_aKeyCreator.isCategoryIdentifierKey(aKey))
                {
                    m_aResults.emplace_back(svx::ClassificationType::CATEGORY,
                                           svx::classification::getProperty(m_xPropertyContainer, aKey),
                                           sBlank, sBlank);
                }
                else if (m_aKeyCreator.isMarkingKey(aKey))
                {
                    m_aResults.emplace_back(svx::ClassificationType::MARKING,
                                           svx::classification::getProperty(m_xPropertyContainer, aKey),
                                           sBlank, sBlank);
                }
                else if (m_aKeyCreator.isIntellectualPropertyPartKey(aKey))
                {
                    m_aResults.emplace_back(svx::ClassificationType::INTELLECTUAL_PROPERTY_PART,
                                           svx::classification::getProperty(m_xPropertyContainer, aKey),
                                           sBlank, sBlank);
                }
            }
        }
    }

public:
    ClassificationCollector(sd::DrawViewShell & rDrawViewShell, const css::uno::Reference<css::document::XDocumentProperties>& rDocProps)
        : ClassificationCommon(rDrawViewShell, rDocProps)
    {}

    std::vector<svx::ClassificationResult> const & getResults() const
    {
        return m_aResults;
    }

    void collect()
    {
        // Set to MASTER mode
        EditMode eOldMode = m_rDrawViewShell.GetEditMode();
        if (eOldMode != EditMode::MasterPage)
            m_rDrawViewShell.ChangeEditMode(EditMode::MasterPage, false);

        // Scoped guard to revert to the previous mode
        comphelper::ScopeGuard const aGuard([this, eOldMode] () {
            m_rDrawViewShell.ChangeEditMode(eOldMode, false);
        });

        const sal_uInt16 nCount = m_rDrawViewShell.GetDoc()->GetMasterSdPageCount(PageKind::Standard);

        for (sal_uInt16 nPageIndex = 0; nPageIndex < nCount; ++nPageIndex)
        {
            SdPage* pMasterPage = m_rDrawViewShell.GetDoc()->GetMasterSdPage(nPageIndex, PageKind::Standard);
            for (const rtl::Reference<SdrObject>& pObject : *pMasterPage)
            {
                SdrRectObj* pRectObject = dynamic_cast<SdrRectObj*>(pObject.get());
                if (pRectObject && pRectObject->GetTextKind() == SdrObjKind::Text)
                {
                    OutlinerParaObject* pOutlinerParagraphObject = pRectObject->GetOutlinerParaObject();
                    if (pOutlinerParagraphObject)
                    {
                        const EditTextObject& rEditText = pOutlinerParagraphObject->GetTextObject();
                        std::vector<editeng::Section> aSections;
                        rEditText.GetAllSections(aSections);

                        // Search for a custom property field that has the classification category identifier key
                        if (hasCustomPropertyField(aSections, m_aKeyCreator.makeCategoryNameKey()))
                        {
                            iterateSectionsAndCollect(aSections, rEditText);
                            return;
                        }
                    }
                }
            }
        }
    }
};

class ClassificationInserter : public ClassificationCommon
{
private:
    /// Delete the previous existing classification object(s) - if they exist
    void deleteExistingObjects()
    {
        OUString sKey = m_aKeyCreator.makeCategoryNameKey();

        const sal_uInt16 nCount = m_rDrawViewShell.GetDoc()->GetMasterSdPageCount(PageKind::Standard);

        for (sal_uInt16 nPageIndex = 0; nPageIndex < nCount; ++nPageIndex)
        {
            SdPage* pMasterPage = m_rDrawViewShell.GetDoc()->GetMasterSdPage(nPageIndex, PageKind::Standard);
            for (const rtl::Reference<SdrObject>& pObject : *pMasterPage)
            {
                SdrRectObj* pRectObject = dynamic_cast<SdrRectObj*>(pObject.get());
                if (pRectObject && pRectObject->GetTextKind() == SdrObjKind::Text)
                {
                    OutlinerParaObject* pOutlinerParagraphObject = pRectObject->GetOutlinerParaObject();
                    if (pOutlinerParagraphObject)
                    {
                        const EditTextObject& rEditText = pOutlinerParagraphObject->GetTextObject();
                        std::vector<editeng::Section> aSections;
                        rEditText.GetAllSections(aSections);

                        if (hasCustomPropertyField(aSections, sKey))
                        {
                            pMasterPage->RemoveObject(pRectObject->GetOrdNum());
                        }
                    }
                }
            }
        }
    }

    void fillTheOutliner(Outliner* pOutliner, std::vector<svx::ClassificationResult> const & rResults)
    {
        sal_Int32 nParagraph = -1;
        for (svx::ClassificationResult const & rResult : rResults)
        {

            ESelection aPosition(nParagraph, EE_TEXTPOS_MAX);

            switch (rResult.meType)
            {
                case svx::ClassificationType::TEXT:
                {
                    OUString sKey = m_aKeyCreator.makeNumberedTextKey();
                    svx::classification::addOrInsertDocumentProperty(m_xPropertyContainer, sKey, rResult.msName);
                    pOutliner->QuickInsertField(SvxFieldItem(editeng::CustomPropertyField(sKey, rResult.msName), EE_FEATURE_FIELD), aPosition);
                }
                break;

                case svx::ClassificationType::CATEGORY:
                {
                    OUString sKey = m_aKeyCreator.makeCategoryNameKey();
                    pOutliner->QuickInsertField(SvxFieldItem(editeng::CustomPropertyField(sKey, rResult.msName), EE_FEATURE_FIELD), aPosition);
                }
                break;

                case svx::ClassificationType::MARKING:
                {
                    OUString sKey = m_aKeyCreator.makeNumberedMarkingKey();
                    svx::classification::addOrInsertDocumentProperty(m_xPropertyContainer, sKey, rResult.msName);
                    pOutliner->QuickInsertField(SvxFieldItem(editeng::CustomPropertyField(sKey, rResult.msName), EE_FEATURE_FIELD), aPosition);
                }
                break;

                case svx::ClassificationType::INTELLECTUAL_PROPERTY_PART:
                {
                    OUString sKey = m_aKeyCreator.makeNumberedIntellectualPropertyPartKey();
                    svx::classification::addOrInsertDocumentProperty(m_xPropertyContainer, sKey, rResult.msName);
                    pOutliner->QuickInsertField(SvxFieldItem(editeng::CustomPropertyField(sKey, rResult.msName), EE_FEATURE_FIELD), aPosition);
                }
                break;

                case svx::ClassificationType::PARAGRAPH:
                {
                    nParagraph++;
                    pOutliner->Insert(u""_ustr);

                    SfxItemSetFixed<EE_ITEMS_START, EE_ITEMS_END> aItemSet(m_rDrawViewShell.GetDoc()->GetPool());

                    if (rResult.msName == "BOLD")
                        aItemSet.Put(SvxWeightItem(WEIGHT_BOLD, EE_CHAR_WEIGHT));
                    else
                        aItemSet.Put(SvxWeightItem(WEIGHT_NORMAL, EE_CHAR_WEIGHT));

                    SvxNumRule aDefaultNumRule(SvxNumRuleFlags::NONE, 0, false);
                    aItemSet.Put(SvxNumBulletItem(std::move(aDefaultNumRule), EE_PARA_NUMBULLET));

                    pOutliner->SetParaAttribs(nParagraph, aItemSet);
                }
                break;

                default:
                break;
            }
        }
    }

public:
    ClassificationInserter(sd::DrawViewShell & rDrawViewShell, const css::uno::Reference<css::document::XDocumentProperties>& rDocProps)
        : ClassificationCommon(rDrawViewShell, rDocProps)
    {
    }

    void insert(std::vector<svx::ClassificationResult> const & rResults)
    {
        // Set to MASTER mode
        EditMode eOldMode = m_rDrawViewShell.GetEditMode();
        if (eOldMode != EditMode::MasterPage)
            m_rDrawViewShell.ChangeEditMode(EditMode::MasterPage, false);

        // Scoped guard to revert the mode
        comphelper::ScopeGuard const aGuard([this, eOldMode] () {
            m_rDrawViewShell.ChangeEditMode(eOldMode, false);
        });

        // Delete the previous existing object - if exists
        deleteExistingObjects();

        // Clear properties
        svx::classification::removeAllProperties(m_xPropertyContainer);

        SfxClassificationHelper aHelper(m_xDocumentProperties);

        // Apply properties from the BA policy
        for (svx::ClassificationResult const & rResult : rResults)
        {
            if (rResult.meType == svx::ClassificationType::CATEGORY)
                aHelper.SetBACName(rResult.msName, SfxClassificationHelper::getPolicyType());
        }

        // Insert full text as document property
        svx::classification::insertFullTextualRepresentationAsDocumentProperty(m_xPropertyContainer, m_aKeyCreator, rResults);

        // Create the outliner from the
        Outliner* pOutliner = m_rDrawViewShell.GetDoc()->GetInternalOutliner();
        OutlinerMode eOutlinerMode = pOutliner->GetOutlinerMode();

        comphelper::ScopeGuard const aOutlinerGuard([pOutliner, eOutlinerMode] () {
            pOutliner->Init(eOutlinerMode);
        });

        pOutliner->Init(OutlinerMode::TextObject);

        // Fill the outliner with the text from classification result
        fillTheOutliner(pOutliner, rResults);

        // Calculate to outliner text size
        pOutliner->UpdateFields();
        pOutliner->SetUpdateLayout(true);
        Size aTextSize(pOutliner->CalcTextSize());
        pOutliner->SetUpdateLayout(false);

        // Create objects, apply the outliner and add them (objects) to all master pages
        const sal_uInt16 nCount = m_rDrawViewShell.GetDoc()->GetMasterSdPageCount(PageKind::Standard);

        for (sal_uInt16 nPageIndex = 0; nPageIndex < nCount; ++nPageIndex)
        {
            SdPage* pMasterPage = m_rDrawViewShell.GetDoc()->GetMasterSdPage(nPageIndex, PageKind::Standard);
            if (!pMasterPage)
                continue;

            rtl::Reference<SdrRectObj> pObject = new SdrRectObj(
                *m_rDrawViewShell.GetDoc(), // TTTT should be reference
                ::tools::Rectangle(), SdrObjKind::Text);
            pObject->SetMergedItem(makeSdrTextAutoGrowWidthItem(true));
            pObject->SetOutlinerParaObject(pOutliner->CreateParaObject());
            pMasterPage->InsertObject(pObject.get());

            // Calculate position
            ::tools::Rectangle aRectangle(Point(), pMasterPage->GetSize());
            Point aPosition(aRectangle.Center().X(), aRectangle.Bottom());

            aPosition.AdjustX( -(aTextSize.Width() / 2) );
            aPosition.AdjustY( -(aTextSize.Height()) );

            pObject->SetLogicRect(::tools::Rectangle(aPosition, aTextSize));
        }
    }
};

    void lcl_convertStringArguments(sal_uInt16 nSId, const std::unique_ptr<SfxItemSet>& pArgs)
    {
        const SfxPoolItem* pItem = nullptr;

        if (nSId == SID_ATTR_FILL_COLOR)
        {
            pItem = pArgs->GetItem(SID_ATTR_FILL_COLOR);
            Color aColor = pItem ? static_cast<const XFillColorItem*>(pItem)->GetColorValue() : COL_AUTO;
            if (aColor.IsFullyTransparent())
            {
                const XFillStyleItem aXFillStyleItem(drawing::FillStyle_NONE);
                pArgs->Put(aXFillStyleItem);
            }
            else
            {
                SfxItemState eState = pArgs->GetItemState(SID_ATTR_FILL_STYLE, false, &pItem);
                if (eState != SfxItemState::SET || static_cast<const XFillStyleItem*>(pItem)->GetValue() == drawing::FillStyle_NONE)
                {
                    const XFillStyleItem aXFillStyleItem(drawing::FillStyle_SOLID);
                    pArgs->Put(aXFillStyleItem);
                }
            }
        }
        if (SfxItemState::SET == pArgs->GetItemState(SID_ATTR_LINE_WIDTH_ARG, false, &pItem))
        {
            double fValue = static_cast<const SvxDoubleItem*>(pItem)->GetValue();
            // FIXME: different units...
            int nPow = 100;
            int nValue = fValue * nPow;

            XLineWidthItem aItem(nValue);
            pArgs->Put(aItem);
        }
        if (SfxItemState::SET == pArgs->GetItemState(SID_FILL_GRADIENT_JSON, false, &pItem))
        {
            const SfxStringItem* pJSON = static_cast<const SfxStringItem*>(pItem);
            if (pJSON)
            {
                basegfx::BGradient aGradient = basegfx::BGradient::fromJSON(pJSON->GetValue());
                XFillGradientItem aItem(aGradient);
                pArgs->Put(aItem);
            }
        }
    }

void lcl_NotifySpeakerNotesChanged(sal_uInt64 nSlideId, std::string_view rRequestId)
{
    tools::JsonWriter aState;
    aState.put("slideId", nSlideId);
    aState.put("requestId", rRequestId);

    tools::JsonWriter aPayload;
    aPayload.put("commandName", ".uno:KitSpeakerNotesChanged");
    aPayload.put("state", aState.finishAndGetAsOString());
    KitHelper::notifyAllViews(KIT_CALLBACK_STATE_CHANGED, aPayload.finishAndGetAsOString());
}

OUString lcl_GetSpeakerNotesText(const SdrTextObj& rNotesText)
{
    if (rNotesText.IsEmptyPresObj())
        return OUString();

    const OutlinerParaObject* pParagraphs = rNotesText.GetOutlinerParaObject();
    if (!pParagraphs)
        return OUString();

    OUStringBuffer aText;
    const EditTextObject& rTextObject = pParagraphs->GetTextObject();
    for (sal_Int32 nParagraph = 0; nParagraph < rTextObject.GetParagraphCount(); ++nParagraph)
    {
        if (nParagraph > 0)
            aText.append('\n');
        aText.append(rTextObject.GetText(nParagraph));
    }
    return aText.makeStringAndClear();
}

SdrTextObj* lcl_FindSpeakerNotesText(SdPage& rNotesPage)
{
    SdrObject* pNotes = rNotesPage.GetPresObj(PresObjKind::Notes);
    if (!pNotes)
    {
        // Match presentation-info readback for imported presentations whose
        // notes text object was not registered as a presentation object.
        for (size_t nNote = 0; nNote < rNotesPage.GetObjCount(); ++nNote)
        {
            SdrObject* pCandidate = rNotesPage.GetObj(nNote);
            if (pCandidate && !rNotesPage.IsPresObj(pCandidate) && pCandidate->HasText()
                && (pCandidate->GetObjIdentifier() == SdrObjKind::Text
                    || pCandidate->GetObjIdentifier() == SdrObjKind::TitleText
                    || pCandidate->GetObjIdentifier() == SdrObjKind::OutlineText))
            {
                pNotes = pCandidate;
                break;
            }
        }
    }

    return DynCastSdrTextObj(pNotes);
}

bool lcl_SetSpeakerNotes(DrawViewShell& rViewShell, sal_uInt64 nSlideId,
                         const OUString& rNotes, std::string_view rRequestId)
{
    SdDrawDocument* pDocument = rViewShell.GetDoc();
    if (!pDocument)
        return false;

    SdPage* pStandardPage = nullptr;
    sal_uInt16 nSlideIndex = 0;
    const sal_uInt16 nPageCount = pDocument->GetSdPageCount(PageKind::Standard);
    for (; nSlideIndex < nPageCount; ++nSlideIndex)
    {
        SdPage* pCandidate = pDocument->GetSdPage(nSlideIndex, PageKind::Standard);
        if (pCandidate && pCandidate->GetUniqueID() == nSlideId)
        {
            pStandardPage = pCandidate;
            break;
        }
    }

    if (!pStandardPage)
    {
        lcl_LogWarning("FillApi SlideCmd SetSpeakerNotes: stable slide ID not found: "
                       + std::to_string(nSlideId));
        return false;
    }

    SdPage* pNotesPage = pDocument->GetSdPage(nSlideIndex, PageKind::Notes);
    SdrTextObj* pNotesText = pNotesPage ? lcl_FindSpeakerNotesText(*pNotesPage) : nullptr;
    if (!pNotesPage || !pNotesText)
    {
        lcl_LogWarning("FillApi SlideCmd SetSpeakerNotes: notes placeholder missing for slide ID "
                       + std::to_string(nSlideId));
        return false;
    }

    // Blur and slide navigation can flush the same textarea draft more than
    // once. Treat the placeholder as empty and avoid polluting Undo/modified
    // state when the normalized paragraph text is already authoritative.
    if (lcl_GetSpeakerNotesText(*pNotesText) == rNotes)
        return true;

    if (pNotesPage->GetPresObj(PresObjKind::Notes) != pNotesText)
    {
        // Repair the semantic registration in imported decks. This makes
        // subsequent empty/nonempty writes resolve the same object without
        // broad scans which could select a date, footer, or page label.
        pNotesPage->InsertPresObj(pNotesText, PresObjKind::Notes);
    }

    // A speaker-note edit is one document-level undo action even though it
    // targets a notes page which is not currently displayed.
    pDocument->BegUndo(SdResId(STR_TRANSFORM));
    comphelper::ScopeGuard aEndUndo([pDocument]() { pDocument->EndUndo(); });
    pDocument->AddUndo(
        pDocument->GetSdrUndoFactory().CreateUndoObjectSetText(*pNotesText, 0));

    if (rNotes.isEmpty())
    {
        if (!pNotesPage->RestoreDefaultText(
                pNotesText, pNotesText->GetCustomPromptText()))
        {
            // Never hide stale content if a malformed imported object cannot
            // restore the normal notes prompt.
            pNotesText->SetText(OUString());
        }
        pNotesText->SetEmptyPresObj(true);
    }
    else
    {
        pNotesText->SetText(rNotes);
        pNotesText->SetEmptyPresObj(false);
    }

    pDocument->EndUndo();
    aEndUndo.dismiss();
    pNotesText->ActionChanged();
    pNotesText->BroadcastObjectChange();
    if (DrawDocShell* pDocShell = rViewShell.GetDocSh())
        pDocShell->SetModified();

    lcl_NotifySpeakerNotesChanged(nSlideId, rRequestId);
    return true;
}
}

void DrawViewShell::FuTransformDocumentStructure(SfxRequest& rReq)
{
    // Collect warnings from sub-commands so we can report them to the caller.
    TransformWarningCollector aWarnings;

    // get the parameter, what to transform
    OUString aDataJson;
    const SfxStringItem* pDataJson = rReq.GetArg<SfxStringItem>(FN_PARAM_1);
    if (pDataJson)
    {
        aDataJson = pDataJson->GetValue();
        aDataJson = rtl::Uri::decode(aDataJson, rtl_UriDecodeStrict, RTL_TEXTENCODING_UTF8);
    }

    // parse the JSON transform parameter
    boost::property_tree::ptree aTree;
    std::stringstream aStream(
        (std::string(OUStringToOString(aDataJson, RTL_TEXTENCODING_UTF8))));
    try
    {
        // read_json recurses once per nesting level: a client-relayed body
        // nested deep enough would exhaust the stack, so it is refused as
        // malformed first.
        if (!sd::pdfpage::JsonNestingWithin(aStream.str(), sd::pdfpage::MODEL_MAX_JSON_NESTING))
            throw boost::property_tree::json_parser::json_parser_error("nested too deeply", "", 0);
        boost::property_tree::read_json(aStream, aTree);
    }
    catch (...)
    {
        lcl_LogWarning("FillApi Transform parameter, Wrong JSON format. ");
        throw;
    }

    const auto aRequestId = aTree.get_optional<std::string>("RequestId");
    const auto aResponseChannel = aTree.get_optional<std::string>("ResponseChannel");
    bool bSuccess = true;
    bool bHasSpeakerNotesSlideId = false;
    sal_uInt64 nSpeakerNotesSlideId = 0;

    // Where the user's view was when the batch arrived, plus the batch's
    // final slide-command key: agent batches must not hijack the user's view
    // (the co-working contract), so unless the batch ENDS in a bare
    // JumpToSlide/JumpToSlideByName - the one sanctioned way for a batch to
    // navigate - the view is switched back to this page after the commands.
    // The page is captured by IDENTITY, not position: Insert/Duplicate/
    // Move/DeleteSlide renumber positions, and an index restore would land
    // the user one slide off. Restore only applies in Page edit mode - the
    // tab position in MasterPage mode indexes a different page list.
    const sal_uInt16 nEntryPageId = maTabControl->GetCurPagePos();
    const bool bEntryPageMode = GetEditMode() == EditMode::Page;
    const SdPage* pEntryPage
        = bEntryPageMode && nEntryPageId < GetDoc()->GetSdPageCount(PageKind::Standard)
              ? GetDoc()->GetSdPage(nEntryPageId, PageKind::Standard)
              : nullptr;
    std::string aLastCommandKey;

    // Objects created by this batch (InsertTextBox), reported back to the
    // caller as slide index + ordinal so follow-up commands can address them.
    std::vector<std::pair<int, sal_uInt32>> aCreatedObjects;
    // The same objects by identity, for MarkCreated: ordNums shift when a
    // FormatGroup in the same batch collapses members into a group object,
    // pointers do not (the page keeps a reference).
    std::vector<SdrObject*> aCreatedSdrObjects;

    // Every undo action the transform's sub-commands generate lands inside
    // ONE list action tagged with THIS view's id. The nested UnoCommand
    // dispatches record their actions under whatever SfxViewShell::Current()
    // is at creation time, which is not reliably the requesting view — the
    // resulting top-of-stack entry then failed ImpSidUndo's COKit ownership
    // check, and a plain .uno:Undo after an agent batch popped the
    // document-repair dialog instead of undoing. One list action also makes
    // one batch = one honest undo step. LeaveListAction prunes the entry
    // when a read-only transform added no actions.
    SfxUndoManager* pBatchUndoManager
        = GetDocSh() ? GetDocSh()->GetUndoManager() : nullptr;
    if (pBatchUndoManager)
        pBatchUndoManager->EnterListAction(SdResId(STR_TRANSFORM), u""_ustr, 0,
                                           GetViewShellBase().GetViewShellId());
    comphelper::ScopeGuard aBatchUndoGuard(
        [pBatchUndoManager]()
        {
            if (pBatchUndoManager)
                pBatchUndoManager->LeaveListAction();
        });

    try
    {
    // Iterate through the JSON data loaded into a tree structure
    for (const auto& aItem : aTree)
    {
        if (aItem.first == "Transforms")
        {
            // Handle all transformations
            for (const auto& aItem2Obj : aItem.second)
            {
                // handle `"Transforms": { `  and `"Transforms": [` cases as well
                // if an element is an object `{...}`, then get the first element of the object
                const auto& aItem2
                    = aItem2Obj.first == "" ? *aItem2Obj.second.ordered_begin() : aItem2Obj;

                //jump to slide
                if (aItem2.first == "SlideCommands")
                {
                    int nActPageId = -1;
                    int nNextPageId = 0;
                    for (const auto& aItem3Obj : aItem2.second)
                    {
                        // It accept direct property, or object as well
                        const auto& aItem3 = aItem3Obj.first == ""
                                                 ? *aItem3Obj.second.ordered_begin()
                                                 : aItem3Obj;

                        aLastCommandKey = aItem3.first;

                        sal_uInt16 nPageCount
                            = GetDoc()->GetSdPageCount(PageKind::Standard);
                        sal_uInt16 nMasterPageCount
                            = GetDoc()->GetMasterSdPageCount(PageKind::Standard);

                        // These commands target a specific page directly, so
                        // skip view navigation to avoid jumping away from the
                        // user's current slide. The PDF canvas verbs name
                        // their page in the value (BuildPdfPageModel
                        // "<page>|...", DecomposePdfPages "a-b") or none at
                        // all (AddWebFont registers a font process-wide);
                        // the client posts them on its own, often while the
                        // user is on another page, so a lazy SwitchPage here
                        // would bounce the view (and end a live text edit)
                        // before the entry-page restore below.
                        bool bDirectPageTarget
                            = aItem3.first.starts_with("InsertImageAt.")
                              || aItem3.first.starts_with("InsertTextBox.")
                              || aItem3.first.starts_with("InsertShape.")
                              || aItem3.first.starts_with("SetSpeakerNotes.")
                              || aItem3.first == "DecomposePdfPages"
                              || aItem3.first == "BuildPdfPageModel"
                              || aItem3.first == "AddWebFont";

                        if (!bDirectPageTarget && nActPageId != nNextPageId)
                        {
                            // Make it sure it always point to a real page
                            if (nNextPageId < 0)
                                nNextPageId = 0;
                            if (nNextPageId >= nPageCount)
                                nNextPageId = nPageCount - 1;

                            nActPageId = nNextPageId;
                            // Switch through the SHELL's own page navigation.
                            // The raw SetCurPageId + ShowSdrPage pair this
                            // replaced tore down the SdrPageView underneath
                            // the current function's state: after ANY
                            // interactive batch, rubber-band marking (and
                            // with it marquee selection) was dead for the
                            // rest of the session. SwitchPage is what a tab
                            // click runs - it no-ops on the current page and
                            // does the full bookkeeping across pages. It can
                            // REFUSE (nested call, mid-paint deferral): then
                            // view-addressed verbs would pair objects with
                            // the wrong SdrPageView, so skip the command
                            // rather than run it against the wrong page
                            // (adversarial review #6).
                            if (!SwitchPage(static_cast<sal_uInt16>(nActPageId),
                                            /*bAllowChangeFocus=*/false)
                                && maTabControl->GetCurPagePos() != nActPageId)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd: page switch refused; skipping command");
                                nActPageId = -1;
                                continue;
                            }
                        }

                        if (aItem3.first == "JumpToSlide")
                        {
                            std::string aIndex = aItem3.second.get_value<std::string>();
                            if (aIndex == "last")
                            {
                                nNextPageId = nPageCount - 1;
                            }
                            else
                            {
                                nNextPageId = aItem3.second.get_value<int>();
                                if (nNextPageId >= nPageCount)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd: Slide idx >= Slide count. '"
                                        + aItem3.first + ": " + aIndex
                                        + "' (Slide count = " + std::to_string(nPageCount));
                                    nNextPageId = nPageCount - 1;
                                }
                                else if (nNextPageId < 0)
                                {
                                    lcl_LogWarning("FillApi SlideCmd: Slide idx < 0. '"
                                                   + aItem3.first + ": " + aIndex + "'");
                                    nNextPageId = 0;
                                }
                            }
                        }
                        if (aItem3.first == "JumpToSlideByName")
                        {
                            std::string aPageName = aItem3.second.get_value<std::string>();
                            int nId = 0;
                            while (
                                nId < nPageCount
                                && GetDoc()->GetSdPage(nId, PageKind::Standard)->GetName()
                                       != OStringToOUString(aPageName,
                                                            RTL_TEXTENCODING_UTF8))
                            {
                                nId++;
                            }
                            if (nId < nPageCount)
                            {
                                nNextPageId = nId;
                            }
                            else
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd: Slide name not found at: '"
                                    + aItem3.first + ": " + aPageName + "'");
                            }
                        }
                        else if (aItem3.first == "InsertMasterSlide"
                                 || aItem3.first == "InsertMasterSlideByName")
                        {
                            int nMasterPageId = 0;
                            if (aItem3.first == "InsertMasterSlideByName")
                            {
                                int nMId = 0;
                                std::string aMPageName
                                    = aItem3.second.get_value<std::string>();
                                while (
                                    nMId < nMasterPageCount
                                    && GetDoc()->GetMasterSdPage(nMId, PageKind::Standard)
                                               ->GetName()
                                           != OStringToOUString(aMPageName,
                                               RTL_TEXTENCODING_UTF8))
                                {
                                    nMId++;
                                }
                                if (nMId < nMasterPageCount)
                                {
                                    nMasterPageId = nMId;
                                }
                                else
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd: MasterSlide name not found at: '"
                                        + aItem3.first + ": " + aMPageName + "'");
                                }
                            }
                            else
                            {
                                nMasterPageId = aItem3.second.get_value<int>();
                            }

                            if (nMasterPageId >= nMasterPageCount)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd: Slide idx >= MasterSlide count. '"
                                    + aItem3.first + ": " + std::to_string(nMasterPageId)
                                    + "' (Slide count = " + std::to_string(nMasterPageCount));
                                nMasterPageId = nMasterPageCount - 1;
                            }
                            else if (nMasterPageId < 0)
                            {
                                lcl_LogWarning("FillApi SlideCmd: Slide idx < 0. '"
                                               + aItem3.first + ": "
                                               + std::to_string(nMasterPageId) + "'");
                                nMasterPageId = 0;
                            }

                            SdPage* pMPage = GetDoc()->GetMasterSdPage(nMasterPageId,
                                                                       PageKind::Standard);
                            // The notes master paired with that slide master (masters
                            // come in standard/notes pairs, as SdDrawPage::
                            // setMasterPage pairs them). Handing the notes page the
                            // SLIDE master made its next layout pass find no notes
                            // placeholder there and create one ON the slide master,
                            // so every slide showed "Click to edit the notes format"
                            // and the export wrote it as plain text.
                            SdPage* pNotesMPage
                                = GetDoc()->GetMasterSdPage(nMasterPageId, PageKind::Notes);
                            SdPage* pPage
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);

                            // It will move to the next slide.
                            nNextPageId = GetDoc()->CreatePage(
                                pPage, PageKind::Standard, OUString(), OUString(),
                                AUTOLAYOUT_TITLE_CONTENT, AUTOLAYOUT_NOTES, true, true,
                                pPage->GetPageNum() + 2);

                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nNextPageId, PageKind::Standard);
                            SdPage* pPageNote
                                = GetDoc()->GetSdPage(nNextPageId, PageKind::Notes);

                            // Change master value. Without a paired notes master the
                            // notes page keeps the one CreatePage gave it (the
                            // current slide's), never the slide master.
                            pPageStandard->TRG_SetMasterPage(*pMPage);
                            if (pNotesMPage)
                                pPageNote->TRG_SetMasterPage(*pNotesMPage);
                        }
                        else if (aItem3.first == "DeleteSlide")
                        {
                            int nPageIdToDel = nActPageId;
                            if (aItem3.second.get_value<std::string>() != "")
                            {
                                nPageIdToDel = aItem3.second.get_value<int>();
                            }

                            if (nPageCount > 1)
                            {
                                if (nPageIdToDel >= nPageCount)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd: Slide idx >= Slide count. '"
                                        + aItem3.first + ": " + std::to_string(nPageIdToDel)
                                        + "' (Slide count = " + std::to_string(nPageCount));
                                    nPageIdToDel = nPageCount - 1;
                                }
                                else if (nPageIdToDel < 0)
                                {
                                    lcl_LogWarning("FillApi SlideCmd: Slide idx < 0. '"
                                                   + aItem3.first + ": "
                                                   + std::to_string(nPageIdToDel) + "'");
                                    nPageIdToDel = 0;
                                }
                                // The undo actions take a reference on the
                                // removed pages (standard + notes), making
                                // the batch's list action restore them.
                                //
                                // ORDER IS LOAD-BEARING, and it is the notes
                                // page FIRST. Both actions record their index
                                // before either RemovePage runs, and the list
                                // action replays children in REVERSE, so
                                // registering notes first restores standard at
                                // 2k+1 and only then notes at 2k+2 -- the
                                // pairing every positional notes lookup depends
                                // on (SdDrawPage::getNotesPage computes
                                // (GetPageNum()-1)>>1). Registered the other
                                // way round, undo interleaves the two lists and
                                // the next save writes each slide its
                                // neighbour's speaker notes. Upstream says the
                                // same at unomodel.cxx:6043/:6320 ("The order
                                // of adding the undo actions is important").
                                if (pBatchUndoManager)
                                {
                                    pBatchUndoManager->AddUndoAction(
                                        GetDoc()->GetSdrUndoFactory().CreateUndoDeletePage(
                                            *GetDoc()->GetPage(nPageIdToDel * 2 + 2)));
                                    pBatchUndoManager->AddUndoAction(
                                        GetDoc()->GetSdrUndoFactory().CreateUndoDeletePage(
                                            *GetDoc()->GetPage(nPageIdToDel * 2 + 1)));
                                }
                                GetDoc()->RemovePage(nPageIdToDel * 2 + 1);
                                GetDoc()->RemovePage(nPageIdToDel * 2 + 1);

                                if (nPageIdToDel <= nActPageId)
                                {
                                    nNextPageId--;
                                }
                            }
                            else
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd: Not enough Slide to delete 1. '"
                                    + aItem3.first + ": " + std::to_string(nPageIdToDel));
                            }
                        }
                        else if (aItem3.first.starts_with("MoveSlide"))
                        {
                            int nMoveFrom = nActPageId;
                            if (aItem3.first.starts_with("MoveSlide."))
                            {
                                nMoveFrom = stoi(aItem3.first.substr(10));
                            }
                            int nMoveTo = aItem3.second.get_value<int>();

                            if (nMoveFrom == nMoveTo)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd: Move slide to the same position. '"
                                    + aItem3.first + ": " + std::to_string(nMoveTo));
                            }
                            else if (nMoveFrom >= nPageCount || nMoveTo > nPageCount)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd: Slide idx >= Slide count. '"
                                    + aItem3.first + ": " + std::to_string(nMoveTo));
                            }
                            else if (nMoveFrom < 0 || nMoveTo < 0)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd: Slide idx < 0. '"
                                    + aItem3.first + ": " + std::to_string(nMoveTo));
                            }
                            else
                            {
                                // Move both the standard and the Note Page.
                                // First move the page that will not change
                                // the order of the other page.
                                int nFirst = 1;
                                if (nMoveFrom < nMoveTo)
                                {
                                    nFirst = 2;
                                }
                                int nSecond = 3 - nFirst;

                                if (pBatchUndoManager)
                                {
                                    pBatchUndoManager->AddUndoAction(
                                        GetDoc()->GetSdrUndoFactory().CreateUndoSetPageNum(
                                            *GetDoc()->GetPage(nMoveFrom * 2 + nFirst),
                                            nMoveFrom * 2 + nFirst, nMoveTo * 2 + nFirst));
                                    pBatchUndoManager->AddUndoAction(
                                        GetDoc()->GetSdrUndoFactory().CreateUndoSetPageNum(
                                            *GetDoc()->GetPage(nMoveFrom * 2 + nSecond),
                                            nMoveFrom * 2 + nSecond, nMoveTo * 2 + nSecond));
                                }
                                GetDoc()->MovePage(nMoveFrom * 2 + nFirst,
                                                   nMoveTo * 2 + nFirst);
                                GetDoc()->MovePage(nMoveFrom * 2 + nSecond,
                                                   nMoveTo * 2 + nSecond);

                                // If the act page is moved, then follow it.
                                if (nActPageId == nMoveFrom)
                                {
                                    nNextPageId = nMoveTo;
                                }
                                else if (nMoveFrom < nActPageId && nMoveTo >= nActPageId)
                                {
                                    nNextPageId = nActPageId - 1;
                                }
                                else if (nMoveFrom > nActPageId && nMoveTo <= nActPageId)
                                {
                                    nNextPageId = nActPageId + 1;
                                }
                            }
                        }
                        else if (aItem3.first == "DuplicateSlide")
                        {
                            int nDupSlideId = nActPageId;
                            if (aItem3.second.get_value<std::string>() != "")
                            {
                                nDupSlideId = aItem3.second.get_value<int>();
                            }

                            if (nDupSlideId >= nPageCount)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd: Slide idx >= Slide count. '"
                                    + aItem3.first + ": " + std::to_string(nDupSlideId)
                                    + "' (Slide count = " + std::to_string(nPageCount));
                                nDupSlideId = nPageCount - 1;
                            }
                            else if (nDupSlideId < 0)
                            {
                                lcl_LogWarning("FillApi SlideCmd: Slide idx < 0. '"
                                               + aItem3.first + ": "
                                               + std::to_string(nDupSlideId) + "'");
                                nDupSlideId = 0;
                            }
                            GetDoc()->DuplicatePage(nDupSlideId);
                            // Register the created standard + notes pages so
                            // one undo removes the duplicate again.
                            if (pBatchUndoManager)
                            {
                                pBatchUndoManager->AddUndoAction(
                                    GetDoc()->GetSdrUndoFactory().CreateUndoCopyPage(
                                        *GetDoc()->GetPage((nDupSlideId + 1) * 2 + 1)));
                                pBatchUndoManager->AddUndoAction(
                                    GetDoc()->GetSdrUndoFactory().CreateUndoCopyPage(
                                        *GetDoc()->GetPage((nDupSlideId + 1) * 2 + 2)));
                            }
                            // Jump to the created page.
                            nNextPageId = nDupSlideId + 1;
                            // Make sure the current page will be set also.
                            nActPageId = nDupSlideId;
                        }
                        else if (aItem3.first == "ChangeLayout"
                                 || aItem3.first == "ChangeLayoutByName")
                        {
                            AutoLayout nLayoutId;
                            if (aItem3.first == "ChangeLayoutByName")
                            {
                                std::string aLayoutName
                                    = aItem3.second.get_value<std::string>();

                                nLayoutId = SdPage::stringToAutoLayout(
                                    OStringToOUString(aLayoutName, RTL_TEXTENCODING_UTF8));
                                if (nLayoutId == AUTOLAYOUT_END)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd: Layout name not found at: '"
                                        + aItem3.first + ": " + aLayoutName + "'");
                                    nLayoutId = AUTOLAYOUT_TITLE_CONTENT;
                                }
                            }
                            else
                            {
                                nLayoutId = static_cast<AutoLayout>(
                                    aItem3.second.get_value<int>());
                                if (nLayoutId < AUTOLAYOUT_START
                                    || nLayoutId >= AUTOLAYOUT_END)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd: Wrong Layout index at: '"
                                        + aItem3.first + ": " + std::to_string(nLayoutId)
                                        + "'");
                                    nLayoutId = AUTOLAYOUT_TITLE_CONTENT;
                                }
                            }

                            // Todo warning:  ... if (nLayoutId >= ???)
                            GetDoc()
                                ->GetSdPage(nActPageId, PageKind::Standard)
                                ->SetAutoLayout(nLayoutId, true);
                        }
                        else if (aItem3.first == "RenameSlide")
                        {
                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);
                            const OUString aNewName = OStringToOUString(
                                aItem3.second.get_value<std::string>(),
                                RTL_TEXTENCODING_UTF8);
                            // ModifyPageUndoAction reads the OLD name off the
                            // page, so it must be created before SetName. The
                            // visibility args mirror the interactive rename
                            // (drviewsb.cxx): current master-layer state, so
                            // undo/redo only ever changes the name.
                            if (pBatchUndoManager)
                            {
                                SdrLayerAdmin& rLayerAdmin
                                    = GetDoc()->GetLayerAdmin();
                                const SdrLayerIDSet aVisibleLayers
                                    = pPageStandard
                                          ->TRG_GetMasterPageVisibleLayers();
                                pBatchUndoManager->AddUndoAction(
                                    std::make_unique<ModifyPageUndoAction>(
                                        *GetDoc(), pPageStandard, aNewName,
                                        pPageStandard->GetAutoLayout(),
                                        aVisibleLayers.IsSet(
                                            rLayerAdmin.GetLayerID(
                                                sUNO_LayerName_background)),
                                        aVisibleLayers.IsSet(
                                            rLayerAdmin.GetLayerID(
                                                sUNO_LayerName_background_objects))));
                            }
                            pPageStandard->SetName(aNewName);
                        }
                        else if (aItem3.first.starts_with("SetSpeakerNotes."))
                        {
                            const std::string aStableId = aItem3.first.substr(16);
                            try
                            {
                                size_t nParsed = 0;
                                nSpeakerNotesSlideId = std::stoull(aStableId, &nParsed);
                                if (nParsed != aStableId.size())
                                    throw std::invalid_argument("trailing characters");
                                bHasSpeakerNotesSlideId = true;

                                const OUString aNotes = OStringToOUString(
                                    aItem3.second.get_value<std::string>(),
                                    RTL_TEXTENCODING_UTF8);
                                if (!lcl_SetSpeakerNotes(
                                        *this, nSpeakerNotesSlideId, aNotes,
                                        aRequestId ? std::string_view(*aRequestId)
                                                   : std::string_view()))
                                {
                                    bSuccess = false;
                                }
                            }
                            catch (const std::exception&)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd SetSpeakerNotes: invalid stable slide ID in '"
                                    + aItem3.first + "'");
                                bSuccess = false;
                            }
                        }
                        else if (aItem3.first.starts_with("SetText."))
                        {
                            int nObjId = stoi(aItem3.first.substr(8));

                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);
                            int nObjCount = pPageStandard->GetObjCount();
                            if (nObjId < 0)
                            {
                                lcl_LogWarning("FillApi SlideCmd SetText: Object idx < 0. '"
                                               + aItem3.first + "'");
                            }
                            else if (nObjId < nObjCount)
                            {
                                SdrObject* pSdrObj = pPageStandard->GetObj(nObjId);
                                if (pSdrObj->IsSdrTextObj())
                                {
                                    SdrTextObj* pSdrTxt = static_cast<SdrTextObj*>(pSdrObj);
                                    // Capture the old text BEFORE mutating so
                                    // the batch's list action can revert it -
                                    // SetText alone records nothing and the
                                    // ack had to carry undoReliable:false.
                                    if (pBatchUndoManager)
                                        pBatchUndoManager->AddUndoAction(
                                            GetDoc()->GetSdrUndoFactory()
                                                .CreateUndoObjectSetText(*pSdrObj, 0));
                                    // Keep the look. SdrTextObj::SetText replaces
                                    // the runs with default-formatted text, so an
                                    // object whose font / size / weight / colour
                                    // ride the CHARACTER attributes (every imported
                                    // PDF text run) came back in the default face —
                                    // a one-pager headline re-set by the agent
                                    // exported in Carlito. Replace the text the way
                                    // typing does: through the outliner, over a
                                    // selection of the whole text, so the inserted
                                    // text inherits the attributes at the start.
                                    const OUString aNewText = OStringToOUString(
                                        aItem3.second.get_value<std::string>(),
                                        RTL_TEXTENCODING_UTF8);
                                    const OutlinerParaObject* pOPO
                                        = pSdrTxt->GetOutlinerParaObject();
                                    if (pOPO && pOPO->GetTextObject().GetParagraphCount() > 0)
                                    {
                                        // The model's draw outliner, configured for
                                        // this text object (ImpGetDrawOutliner is
                                        // svx-internal).
                                        SdrOutliner& rOutl = GetDoc()->GetDrawOutliner(pSdrTxt);
                                        rOutl.SetText(*pOPO);
                                        rOutl.QuickInsertText(
                                            aNewText,
                                            ESelection(0, 0, EE_PARA_MAX, EE_TEXTPOS_MAX));
                                        pSdrTxt->SetOutlinerParaObject(rOutl.CreateParaObject());
                                        rOutl.Clear();
                                    }
                                    else
                                        pSdrTxt->SetText(aNewText);
                                    // Todo: maybe with empty string it should work elseway?
                                    pSdrObj->SetEmptyPresObj(false);
                                }
                            }
                            else
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd SetText: Object idx >= Object Count. '"
                                    + aItem3.first
                                    + "' (Object Count = " + std::to_string(nObjCount) + ")");
                            }
                        }
                        else if (aItem3.first.starts_with("FitFrameToText."))
                        {
                            // Composable fit action (Slide Studio W1): size
                            // the addressed text frame to its text, both
                            // axes. ".all" walks every text frame on the
                            // slide - the cleanup flow's first step.
                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);
                            const std::string aTarget = aItem3.first.substr(15);
                            const int nObjCount = static_cast<int>(pPageStandard->GetObjCount());
                            int nFrom = 0;
                            int nTo = nObjCount - 1;
                            if (aTarget != "all")
                            {
                                int nObjId = -1;
                                try
                                {
                                    nObjId = stoi(aTarget);
                                }
                                catch (const std::exception&)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd FitFrameToText: invalid object index in '"
                                        + aItem3.first + "'");
                                    continue;
                                }
                                if (nObjId < 0 || nObjId >= nObjCount)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd FitFrameToText: Object idx out of range. '"
                                        + aItem3.first
                                        + "' (Object Count = " + std::to_string(nObjCount) + ")");
                                    continue;
                                }
                                nFrom = nObjId;
                                nTo = nObjId;
                            }
                            const bool bAllObjects = (aTarget == "all");
                            for (int nIdx = nFrom; nIdx <= nTo; ++nIdx)
                            {
                                SdrObject* pSdrObj = pPageStandard->GetObj(nIdx);
                                SdrTextObj* pSdrTxt = DynCastSdrTextObj(pSdrObj);
                                if (!pSdrTxt || !pSdrTxt->HasText())
                                    continue;
                                // Tables: HasText() is unconditionally true
                                // and getActiveText() is ONE CELL, so a fit
                                // would relay the table to minimum-content
                                // width from a single cell's text, discarding
                                // authored column widths (review P1-6).
                                if (pSdrTxt->GetObjIdentifier()
                                    == SdrObjKind::Table)
                                    continue;
                                // ".all" keeps clear of FILLED design
                                // shapes (a banner must not shrink to its
                                // caption). Discriminate on the fill, not on
                                // IsTextFrame: pptx text boxes import as
                                // unfilled custom shapes, which is most of
                                // every deck (adversarial review #5).
                                if (bAllObjects && !pSdrTxt->IsTextFrame()
                                    && pSdrTxt->GetObjIdentifier() != SdrObjKind::Text
                                    && (pSdrTxt->GetMergedItem(XATTR_FILLSTYLE).GetValue()
                                            != drawing::FillStyle_NONE
                                        || pSdrTxt->GetMergedItem(XATTR_LINESTYLE).GetValue()
                                               != drawing::LineStyle_NONE))
                                    continue;
                                // Fit means HUG: zero the vertical text
                                // insets first so the fitted frame is the
                                // text, not text plus padding a generator
                                // baked in ("the bottom fits but not top" —
                                // the top gap was the stored upper inset,
                                // which the fit honored). Horizontal insets
                                // stay: they set the wrap width, and
                                // zeroing them reflows the text.
                                lcl_FitFrameHug(GetDoc(), pSdrTxt,
                                    [pBatchUndoManager](std::unique_ptr<SdrUndoAction> pUndo)
                                    {
                                        if (pBatchUndoManager)
                                            pBatchUndoManager->AddUndoAction(std::move(pUndo));
                                    });
                            }
                        }
                        else if (aItem3.first.starts_with("InsertImage."))
                        {
                            int nObjId;
                            try
                            {
                                nObjId = stoi(aItem3.first.substr(12));
                            }
                            catch (const std::exception&)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertImage: invalid object index in '"
                                    + aItem3.first + "'");
                                continue;
                            }

                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);
                            int nObjCount = pPageStandard->GetObjCount();
                            if (nObjId < 0)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertImage: Object idx < 0. '"
                                    + aItem3.first + "'");
                            }
                            else if (nObjId >= nObjCount)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertImage: Object idx >= "
                                    "Object Count. '"
                                    + aItem3.first
                                    + "' (Object Count = " + std::to_string(nObjCount)
                                    + ")");
                            }
                            else
                            {
                                std::string aImageUrl
                                    = aItem3.second.get_value<std::string>();
                                lcl_ReplaceWithImage(GetDoc(), pPageStandard,
                                                     nObjId, aImageUrl,
                                                     &GetViewShellBase(),
                                                     nActPageId);
                            }
                        }
                        else if (aItem3.first.starts_with("InsertImageAt."))
                        {
                            // Format: InsertImageAt.SLIDE.OBJ
                            // Inserts image on a specific slide without
                            // changing the active page view.
                            std::string suffix = aItem3.first.substr(14);
                            auto dotPos = suffix.find('.');
                            if (dotPos == std::string::npos)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertImageAt: missing "
                                    "dot separator in '"
                                    + aItem3.first + "'");
                            }
                            else
                            {
                                int nSlideId;
                                int nObjId;
                                try
                                {
                                    nSlideId = stoi(suffix.substr(0, dotPos));
                                    nObjId = stoi(suffix.substr(dotPos + 1));
                                }
                                catch (const std::exception&)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd InsertImageAt: "
                                        "invalid index in '"
                                        + aItem3.first + "'");
                                    continue;
                                }
                                int nPageCnt = GetDoc()->GetSdPageCount(
                                    PageKind::Standard);

                                if (nSlideId < 0 || nSlideId >= nPageCnt)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd InsertImageAt: "
                                        "slide idx out of range. '"
                                        + aItem3.first + "' (PageCount = "
                                        + std::to_string(nPageCnt) + ")");
                                }
                                else
                                {
                                    SdPage* pPage = GetDoc()->GetSdPage(
                                        nSlideId, PageKind::Standard);
                                    int nObjCount = pPage->GetObjCount();

                                    if (nObjId < 0 || nObjId >= nObjCount)
                                    {
                                        lcl_LogWarning(
                                            "FillApi SlideCmd InsertImageAt:"
                                            " obj idx out of range. '"
                                            + aItem3.first
                                            + "' (ObjCount = "
                                            + std::to_string(nObjCount)
                                            + ")");
                                    }
                                    else
                                    {
                                        std::string aImageUrl
                                            = aItem3.second
                                                  .get_value<std::string>();
                                        lcl_ReplaceWithImage(
                                            GetDoc(), pPage, nObjId,
                                            aImageUrl, &GetViewShellBase(),
                                            nSlideId);
                                    }
                                }
                            }
                        }
                        else if (aItem3.first.starts_with("InsertTextBox."))
                        {
                            // Format: InsertTextBox.SLIDE with value
                            // "<x>,<y>[,<width>]|<text>" (Slide Studio W1).
                            // Creates an unfilled, unstroked text box on the
                            // addressed slide without moving the user's view.
                            // x/y/width are 1/100 mm in the margin-INCLUSIVE
                            // frame ExtractDocumentStructure reports, so the
                            // page borders are subtracted before use. Literal
                            // \n in the text become outliner paragraphs
                            // (Outliner::SetText splits on LF - the same
                            // mechanism SetText.OBJ above rides on).
                            int nSlideId;
                            try
                            {
                                nSlideId = stoi(aItem3.first.substr(14));
                            }
                            catch (const std::exception&)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertTextBox: invalid "
                                    "slide index in '"
                                    + aItem3.first + "'");
                                continue;
                            }
                            if (nSlideId < 0 || nSlideId >= nPageCount)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertTextBox: slide "
                                    "idx out of range. '"
                                    + aItem3.first + "' (PageCount = "
                                    + std::to_string(nPageCount) + ")");
                                continue;
                            }
                            const std::string aValue
                                = aItem3.second.get_value<std::string>();
                            const std::size_t nSep = aValue.find('|');
                            if (nSep == std::string::npos)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertTextBox: missing "
                                    "'|' separator in '"
                                    + aItem3.first + "' value");
                                continue;
                            }
                            std::vector<::tools::Long> aCoords;
                            sal_Int32 nStylePt = 0;
                            bool bStyleBold = false;
                            bool bStyleColor = false;
                            Color aStyleColor;
                            bool bBadCoords = false;
                            std::stringstream aCoordList(
                                aValue.substr(0, nSep));
                            std::string aToken;
                            while (std::getline(aCoordList, aToken, ','))
                            {
                                // Numeric fields are geometry; the optional
                                // trailing style tokens (s<pt>, b, c<6hex>)
                                // style the whole box's text.
                                if (!aToken.empty()
                                    && aToken.find_first_not_of(
                                           "-0123456789")
                                           == std::string::npos)
                                {
                                    try
                                    {
                                        aCoords.push_back(stoi(aToken));
                                        continue;
                                    }
                                    catch (const std::exception&)
                                    {
                                        bBadCoords = true;
                                        break;
                                    }
                                }
                                if (!lcl_ParseInsertStyleToken(
                                        aToken, nStylePt, bStyleBold,
                                        bStyleColor, aStyleColor))
                                {
                                    bBadCoords = true;
                                    break;
                                }
                            }
                            if (bBadCoords || aCoords.size() < 2
                                || aCoords.size() > 3)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertTextBox: invalid "
                                    "geometry in '"
                                    + aItem3.first
                                    + "' value (expected "
                                      "x,y[,width][,style...])");
                                continue;
                            }

                            SdPage* pPage = GetDoc()->GetSdPage(
                                nSlideId, PageKind::Standard);
                            const ::tools::Long nX
                                = aCoords[0] - pPage->GetLeftBorder();
                            const ::tools::Long nY
                                = aCoords[1] - pPage->GetUpperBorder();
                            const bool bHasWidth = aCoords.size() == 3;
                            // Provisional rect: the given width plus a dummy
                            // height, or the page size so unwrapped text can
                            // measure its natural width (the text paste
                            // recipe, svdxcgv.cxx); the fit below settles it.
                            ::tools::Rectangle aRect(
                                Point(nX, nY),
                                bHasWidth ? Size(aCoords[2], 1000)
                                          : pPage->GetSize());
                            rtl::Reference<SdrRectObj> pObj = new SdrRectObj(
                                *GetDoc(), aRect, SdrObjKind::Text);
                            // SetText before SetAttr (svdxcgv.cxx).
                            pObj->NbcSetText(OStringToOUString(
                                aValue.substr(nSep + 1),
                                RTL_TEXTENCODING_UTF8));

                            SfxItemSet aBoxAttr(GetDoc()->GetItemPool());
                            aBoxAttr.Put(
                                XLineStyleItem(drawing::LineStyle_NONE));
                            aBoxAttr.Put(
                                XFillStyleItem(drawing::FillStyle_NONE));
                            aBoxAttr.Put(makeSdrTextAutoGrowHeightItem(true));
                            if (bHasWidth)
                                aBoxAttr.Put(
                                    makeSdrTextAutoGrowWidthItem(false));
                            aBoxAttr.Put(makeSdrTextMinFrameHeightItem(0));
                            aBoxAttr.Put(makeSdrTextMinFrameWidthItem(0));
                            lcl_PutInsertStyleItems(aBoxAttr, nStylePt,
                                                    bStyleBold, bStyleColor,
                                                    aStyleColor);
                            pObj->SetMergedItemSet(aBoxAttr);

                            pPage->InsertObject(pObj.get());
                            if (pBatchUndoManager)
                                pBatchUndoManager->AddUndoAction(
                                    GetDoc()->GetSdrUndoFactory()
                                        .CreateUndoNewObject(*pObj));

                            if (bHasWidth)
                            {
                                // Keep the given width; settle the height on
                                // the wrapped text.
                                pObj->AdjustTextFrameWidthAndHeight();
                            }
                            else
                            {
                                // Hug the text on both axes, top-left
                                // anchored, then let the box keep hugging
                                // it: autogrow width is enabled only now so
                                // the page-wide provisional rect never
                                // shrinks center-anchored.
                                // (The insert undo covers the new object
                                // wholesale, so the hug's undo recorder is
                                // a no-op here.)
                                lcl_FitFrameHug(GetDoc(), pObj.get(),
                                    [](std::unique_ptr<SdrUndoAction>) {});
                                pObj->SetMergedItem(
                                    makeSdrTextAutoGrowWidthItem(true));
                                // The fit ran through SetLogicRect, whose
                                // AdaptTextMinSize reseeded the min-frame
                                // floor from the fitted rect; zero it again
                                // so the box can shrink with its text.
                                pObj->SetMergedItem(
                                    makeSdrTextMinFrameHeightItem(0));
                                pObj->SetMergedItem(
                                    makeSdrTextMinFrameWidthItem(0));
                            }

                            aCreatedObjects.emplace_back(nSlideId,
                                                         pObj->GetOrdNum());
                            aCreatedSdrObjects.push_back(pObj.get());
                            KitHelper::notifyInvalidation(&GetViewShellBase(),
                                                          nSlideId, nullptr);
                        }
                        else if (aItem3.first.starts_with("InsertShape."))
                        {
                            // Format: InsertShape.SLIDE with value
                            // "<kind>,<x>,<y>,<w>,<h>,<fill>,<line>
                            // [,<textColor>][|<text>]" (Slide Studio asset
                            // library: pre-grouped assets are built from
                            // these plus InsertTextBox above). kind is
                            // ellipse|rect|rounded. x/y are 1/100 mm in the
                            // margin-INCLUSIVE frame (borders subtracted,
                            // as InsertTextBox); w/h must be positive and
                            // stay authoritative - the shape never
                            // autogrows. fill/line/textColor are 6-digit
                            // lowercase hex RGB or "none". The optional
                            // |<text> is centered on both axes; literal \n
                            // become outliner paragraphs.
                            int nSlideId;
                            try
                            {
                                nSlideId = stoi(aItem3.first.substr(12));
                            }
                            catch (const std::exception&)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertShape: invalid "
                                    "slide index in '"
                                    + aItem3.first + "'");
                                continue;
                            }
                            if (nSlideId < 0 || nSlideId >= nPageCount)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertShape: slide "
                                    "idx out of range. '"
                                    + aItem3.first + "' (PageCount = "
                                    + std::to_string(nPageCount) + ")");
                                continue;
                            }
                            const std::string aValue
                                = aItem3.second.get_value<std::string>();
                            const std::size_t nSep = aValue.find('|');
                            const bool bHasText
                                = nSep != std::string::npos;

                            std::vector<std::string> aFields;
                            std::stringstream aFieldList(
                                bHasText ? aValue.substr(0, nSep) : aValue);
                            std::string aToken;
                            while (std::getline(aFieldList, aToken, ','))
                                aFields.push_back(aToken);
                            if (aFields.size() < 7 || aFields.size() > 10)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertShape: invalid "
                                    "value (expected kind,x,y,w,h,fill,line"
                                    "[,textColor][,style...][|text])");
                                continue;
                            }
                            const std::string& aKind = aFields[0];
                            // formtext / formcheck: a real form control
                            // (field authoring from the page canvas).
                            const bool bFormKind
                                = aKind == "formtext" || aKind == "formcheck";
                            if (aKind != "ellipse" && aKind != "rect"
                                && aKind != "rounded" && !bFormKind)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertShape: unknown "
                                    "kind '" + aKind + "'");
                                continue;
                            }
                            ::tools::Long nX = 0;
                            ::tools::Long nY = 0;
                            ::tools::Long nW = 0;
                            ::tools::Long nH = 0;
                            try
                            {
                                nX = stoi(aFields[1]);
                                nY = stoi(aFields[2]);
                                nW = stoi(aFields[3]);
                                nH = stoi(aFields[4]);
                            }
                            catch (const std::exception&)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertShape: invalid "
                                    "geometry in '"
                                    + aItem3.first + "' value");
                                continue;
                            }
                            if (nW <= 0 || nH <= 0)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertShape: width "
                                    "and height must be positive");
                                continue;
                            }
                            Color aFillColor;
                            Color aLineColor;
                            Color aTextColor;
                            const bool bFillNone = aFields[5] == "none";
                            const bool bLineNone = aFields[6] == "none";
                            if ((!bFillNone
                                 && !lcl_ParseHexColor(aFields[5],
                                                       aFillColor))
                                || (!bLineNone
                                    && !lcl_ParseHexColor(aFields[6],
                                                          aLineColor)))
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertShape: invalid "
                                    "color (expected 6-digit lowercase hex "
                                    "or 'none')");
                                continue;
                            }
                            // Tail fields: at most one bare 6-hex (or
                            // 'none') textColor - kept for the original
                            // 8-field grammar - plus the shared style
                            // tokens (s<pt>, b, c<6hex>; the c token is
                            // textColor too).
                            bool bHasTextColor = false;
                            sal_Int32 nStylePt = 0;
                            bool bStyleBold = false;
                            bool bBadTail = false;
                            for (size_t nTail = 7; nTail < aFields.size();
                                 ++nTail)
                            {
                                const std::string& rField = aFields[nTail];
                                if (rField == "none")
                                    continue;
                                Color aParsed;
                                if (!bHasTextColor
                                    && lcl_ParseHexColor(rField, aParsed))
                                {
                                    aTextColor = aParsed;
                                    bHasTextColor = true;
                                    continue;
                                }
                                if (lcl_ParseInsertStyleToken(
                                        rField, nStylePt, bStyleBold,
                                        bHasTextColor, aTextColor))
                                    continue;
                                bBadTail = true;
                                break;
                            }
                            if (bBadTail)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd InsertShape: invalid "
                                    "tail field (expected textColor or "
                                    "style tokens)");
                                continue;
                            }

                            SdPage* pPage = GetDoc()->GetSdPage(
                                nSlideId, PageKind::Standard);
                            const ::tools::Rectangle aRect(
                                Point(nX - pPage->GetLeftBorder(),
                                      nY - pPage->GetUpperBorder()),
                                Size(nW, nH));
                            if (bFormKind)
                            {
                                // Form-field AUTHORING (edit behaviour): a
                                // movable form control that exports as an
                                // AcroForm field (ExportFormFields) and
                                // re-imports as one (svdpdf.cxx). |text is
                                // the field name. Filling is the viewer's.
                                const bool bCheck = aKind == "formcheck";
                                rtl::Reference<SdrObject> pCtl
                                    = SdrObjFactory::MakeNewObject(
                                        *GetDoc(), SdrInventor::FmForm,
                                        bCheck ? SdrObjKind::FormCheckbox
                                               : SdrObjKind::FormEdit);
                                SdrUnoObj* pUno
                                    = dynamic_cast<SdrUnoObj*>(pCtl.get());
                                if (!pUno)
                                {
                                    rtl::Reference<SdrUnoObj> pPlain
                                        = new SdrUnoObj(
                                            *GetDoc(),
                                            bCheck ? u"com.sun.star.form.component.CheckBox"_ustr
                                                   : u"com.sun.star.form.component.TextField"_ustr);
                                    pUno = pPlain.get();
                                    pCtl = pPlain.get();
                                }
                                pUno->SetLogicRect(aRect);
                                css::uno::Reference<css::beans::XPropertySet>
                                    xProps(pUno->GetUnoControlModel(),
                                           css::uno::UNO_QUERY);
                                if (xProps.is())
                                {
                                    try
                                    {
                                        if (bHasText)
                                            xProps->setPropertyValue(
                                                u"Name"_ustr,
                                                cpo::uno::Any(OStringToOUString(
                                                    aValue.substr(nSep + 1),
                                                    RTL_TEXTENCODING_UTF8)));
                                        xProps->setPropertyValue(
                                            u"Border"_ustr,
                                            cpo::uno::Any(sal_Int16(2)));
                                        if (bCheck)
                                            xProps->setPropertyValue(
                                                u"Label"_ustr,
                                                cpo::uno::Any(OUString()));
                                    }
                                    catch (const css::uno::Exception&)
                                    {
                                    }
                                }
                                pPage->InsertObject(pCtl.get());
                                if (pBatchUndoManager)
                                    pBatchUndoManager->AddUndoAction(
                                        GetDoc()->GetSdrUndoFactory()
                                            .CreateUndoNewObject(*pCtl));
                                aCreatedObjects.emplace_back(
                                    nSlideId, pCtl->GetOrdNum());
                                aCreatedSdrObjects.push_back(pCtl.get());
                                KitHelper::notifyInvalidation(
                                    &GetViewShellBase(), nSlideId, nullptr);
                                continue;
                            }
                            rtl::Reference<SdrRectObj> pObj;
                            if (aKind == "ellipse")
                                pObj = new SdrCircObj(
                                    *GetDoc(), SdrCircKind::Full, aRect);
                            else
                                pObj = new SdrRectObj(*GetDoc(), aRect);
                            // SetText before SetAttr (svdxcgv.cxx); the
                            // EE_CHAR_COLOR below lands on existing
                            // paragraphs via TextProperties::ItemSetChanged.
                            if (bHasText)
                                pObj->NbcSetText(OStringToOUString(
                                    aValue.substr(nSep + 1),
                                    RTL_TEXTENCODING_UTF8));

                            SfxItemSet aShapeAttr(GetDoc()->GetItemPool());
                            if (bFillNone)
                                aShapeAttr.Put(
                                    XFillStyleItem(drawing::FillStyle_NONE));
                            else
                            {
                                aShapeAttr.Put(XFillStyleItem(
                                    drawing::FillStyle_SOLID));
                                aShapeAttr.Put(XFillColorItem(OUString(),
                                                              aFillColor));
                            }
                            if (bLineNone)
                                aShapeAttr.Put(
                                    XLineStyleItem(drawing::LineStyle_NONE));
                            else
                            {
                                aShapeAttr.Put(XLineStyleItem(
                                    drawing::LineStyle_SOLID));
                                aShapeAttr.Put(XLineColorItem(OUString(),
                                                              aLineColor));
                            }
                            // Assets keep their drawn size: no autogrow on
                            // either axis, text centered inside the shape.
                            aShapeAttr.Put(
                                makeSdrTextAutoGrowWidthItem(false));
                            aShapeAttr.Put(
                                makeSdrTextAutoGrowHeightItem(false));
                            aShapeAttr.Put(SdrTextVertAdjustItem(
                                SDRTEXTVERTADJUST_CENTER));
                            aShapeAttr.Put(SdrTextHorzAdjustItem(
                                SDRTEXTHORZADJUST_CENTER));
                            if (aKind == "rounded")
                                aShapeAttr.Put(makeSdrEckenradiusItem(
                                    std::min(nW, nH) / 8));
                            lcl_PutInsertStyleItems(aShapeAttr, nStylePt,
                                                    bStyleBold,
                                                    bHasTextColor,
                                                    aTextColor);
                            pObj->SetMergedItemSet(aShapeAttr);

                            pPage->InsertObject(pObj.get());
                            if (pBatchUndoManager)
                                pBatchUndoManager->AddUndoAction(
                                    GetDoc()->GetSdrUndoFactory()
                                        .CreateUndoNewObject(*pObj));

                            aCreatedObjects.emplace_back(nSlideId,
                                                         pObj->GetOrdNum());
                            aCreatedSdrObjects.push_back(pObj.get());
                            KitHelper::notifyInvalidation(&GetViewShellBase(),
                                                          nSlideId, nullptr);
                        }
                        else if (aItem3.first == "MarkObject"
                                 || aItem3.first == "UnMarkObject")
                        {
                            bool bUnMark = aItem3.first == "UnMarkObject";
                            int nObjId = aItem3.second.get_value<int>();

                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);
                            int nObjCount = pPageStandard->GetObjCount();

                            // Todo: check id vs count
                            if (nObjId < 0)
                            {
                                lcl_LogWarning("FillApi SlideCmd: Object idx < 0 at: '"
                                               + aItem3.first + std::to_string(nObjId)
                                               + "'");
                            }
                            if (nObjId < nObjCount)
                            {
                                SdrObject* pSdrObj = pPageStandard->GetObj(nObjId);
                                mpDrawView->MarkObj(pSdrObj, mpDrawView->GetSdrPageView(),
                                                    bUnMark);
                            }
                            else
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd: Object idx > Object Count. '"
                                    + aItem3.first + std::to_string(nObjId)
                                    + "' (Object Count = " + std::to_string(nObjId));
                            }
                        }
                        else if (aItem3.first == "MarkObjectPath")
                        {
                            // "<page ordinal>/<member ordinal>[/...]": a member
                            // of a group the view has ENTERED — the browser's
                            // owned press inside a group selects it by path,
                            // the way MarkObject selects a page object by
                            // ordinal. The leaf is marked; a broken path marks
                            // nothing (and says so).
                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);
                            SdrObjList* pList = pPageStandard;
                            SdrObject* pLeaf = nullptr;
                            bool bWalked = true;
                            std::stringstream aPath(aItem3.second.get_value<std::string>());
                            std::string aToken;
                            while (bWalked && std::getline(aPath, aToken, '/'))
                            {
                                int nId = -1;
                                try
                                {
                                    nId = stoi(aToken);
                                }
                                catch (const std::exception&)
                                {
                                    bWalked = false;
                                    break;
                                }
                                if (!pList || nId < 0
                                    || static_cast<size_t>(nId) >= pList->GetObjCount())
                                {
                                    bWalked = false;
                                    break;
                                }
                                pLeaf = pList->GetObj(nId);
                                pList = pLeaf ? pLeaf->GetSubList() : nullptr;
                            }
                            if (bWalked && pLeaf)
                                mpDrawView->MarkObj(pLeaf, mpDrawView->GetSdrPageView());
                            else
                                lcl_LogWarning("FillApi SlideCmd MarkObjectPath: no object at '"
                                               + aItem3.second.get_value<std::string>() + "'");
                        }
                        else if (aItem3.first == "UnmarkAll")
                        {
                            // A command batch must start from a clean
                            // selection: MarkObject appends to the session's
                            // live marks, and JumpToSlide only clears them
                            // when it actually navigates to another page.
                            //
                            // A live text edit ends first, the way a click
                            // away ends it (FuText::MouseButtonDown): the
                            // browser's owned press gesture re-aims the
                            // selection with this verb while the caret is in
                            // another box ("type here, grab that"), and an
                            // edit left running on an object the batch just
                            // unmarked is a state no user gesture can reach.
                            // On a deck the text function stays current, so
                            // the click the browser forwards after the batch
                            // starts editing the box it lands on.
                            //
                            // On the PDF page canvas (Draw) the browser
                            // instead replays a double-click on the object
                            // the batch marks (VulcanImpressSelectEcho
                            // enterTextAt), and with the text function current
                            // a double-click re-enters that function's own
                            // text object (FuText::MouseButtonDown, two
                            // clicks), the box this batch or an Escape just
                            // left, wherever the click landed: the caret came
                            // back at the end of the old box, and when that
                            // failed the new one stayed marked for Backspace
                            // to delete. The function also outlives the gesture
                            // (an owned press sends core no mouse-up), so the
                            // selection function takes over here, as a second
                            // Escape would (FuPoor::cancel), before the
                            // replayed click arrives.
                            //
                            // This verb runs inside FuTemporary, which has put
                            // the permanent function aside (it is the OLD
                            // function until Cancel() restores it after the
                            // batch), unless a verb earlier in the batch has
                            // already restored it (.uno:LeaveGroup's own
                            // Cancel()): the text function is whichever of the
                            // two holds it. FuPermanent makes the selection
                            // function the permanent one in either case and
                            // disposes the text function, so Cancel() restores
                            // selection.
                            if (mpDrawView->IsTextEdit())
                                mpDrawView->SdrEndTextEdit();
                            mpDrawView->UnmarkAll();
                            const rtl::Reference<FuPoor> xPermanentFunction
                                = HasCurrentFunction() ? GetCurrentFunction()
                                                       : GetOldFunction();
                            if (GetDoc()->GetDocumentType() == DocumentType::Draw
                                && dynamic_cast<FuText*>(xPermanentFunction.get()))
                            {
                                SfxRequest aSelectReq(SID_OBJECT_SELECT, SfxCallMode::SLOT,
                                                      GetDoc()->GetItemPool());
                                FuPermanent(aSelectReq);
                            }
                        }

                        else if (aItem3.first == "DecomposePdfPages")
                        {
                            // A PDF opens as ONE protected graphic per page
                            // (SdPdfFilter). To edit it, every page's graphic
                            // is decomposed into drawing-level objects - text,
                            // paths, images - the way the Break action does
                            // for a marked graphic, but for the whole document
                            // at once, page-addressed (no view navigation), and
                            // WITHOUT touching the undo stack or the modified
                            // flag: opening a PDF to edit it is not itself an
                            // edit (an untouched document closes without a
                            // save, byte-identical), and there is no "undo"
                            // back into an uneditable picture. Pages already
                            // decomposed are skipped, so a second call (a
                            // second editor joining) is a no-op.
                            // Undo, the doc shell's modified tracking and
                            // the modified flag are restored however the
                            // block exits (a throw included - the batch
                            // rethrows, and undo must not stay off for the
                            // rest of the session).
                            const bool bUndoEnabled = GetDoc()->IsUndoEnabled();
                            const bool bWasChanged = GetDoc()->IsChanged();
                            DrawDocShell* const pOpenDocShell = GetDocSh();
                            const bool bSetModifiedEnabled
                                = pOpenDocShell && pOpenDocShell->IsEnableSetModified();
                            GetDoc()->EnableUndo(false);
                            if (pOpenDocShell)
                                pOpenDocShell->EnableSetModified(false);
                            comphelper::ScopeGuard aOpenRestore(
                                [this, pOpenDocShell, bSetModifiedEnabled, bUndoEnabled,
                                 bWasChanged]()
                                {
                                    if (pOpenDocShell)
                                        pOpenDocShell->EnableSetModified(bSetModifiedEnabled);
                                    GetDoc()->EnableUndo(bUndoEnabled);
                                    GetDoc()->SetChanged(bWasChanged);
                                });
                            sal_uInt16 nDecomposed = 0;
                            // The value picks the pages: true = every page
                            // (one long verb on a big document), a number =
                            // that page, "a-b" = that range. The client asks
                            // for the page in view first and sweeps the rest
                            // in ranges, so a 150-page PDF is editable where
                            // the reader is within a moment instead of after
                            // the whole document has been taken apart.
                            sal_uInt16 nFirst = 0;
                            sal_uInt16 nLast = nPageCount ? nPageCount - 1 : 0;
                            {
                                const std::string aWhich
                                    = aItem3.second.get_value<std::string>();
                                const size_t nDash = aWhich.find('-');
                                if (!aWhich.empty() && aWhich != "true"
                                    && std::isdigit(static_cast<unsigned char>(aWhich[0])))
                                {
                                    const int nA = std::atoi(aWhich.c_str());
                                    const int nB = nDash == std::string::npos
                                                       ? nA
                                                       : std::atoi(aWhich.c_str() + nDash + 1);
                                    nFirst = static_cast<sal_uInt16>(
                                        std::clamp(nA, 0, std::max(0, nPageCount - 1)));
                                    nLast = static_cast<sal_uInt16>(
                                        std::clamp(nB, static_cast<int>(nFirst),
                                                   std::max(0, nPageCount - 1)));
                                }
                            }
                            // One family-name font map per PDF, kept across
                            // calls (sd::pdfpage::SharedImportFonts): the
                            // importer walks the whole document's text to
                            // build it, which done per page - or per range
                            // call of the client's sweep - was quadratic in
                            // pages.
                            for (sal_uInt16 nPage = nFirst; nPage <= nLast && nPage < nPageCount; ++nPage)
                            {
                                SdPage* pPage = GetDoc()->GetSdPage(nPage, PageKind::Standard);
                                SdrGrafObj* pGraf = pPage ? pPage->GetPdfPageGraphic() : nullptr;
                                if (!pGraf)
                                    continue;
                                const size_t nGrafPos = pGraf->GetOrdNum();
                                const size_t nInserted = SdrEditView::ImportPdfGraphic(
                                    *pGraf, *pPage, nGrafPos + 1,
                                    sd::pdfpage::SharedImportFonts(*pGraf));
                                if (nInserted == 0)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd DecomposePdfPages: page "
                                        + std::to_string(nPage) + " could not be decomposed");
                                    continue;
                                }
                                // The graphic kept its position; the imported
                                // objects follow it.
                                pPage->RemoveObject(nGrafPos);
                                ++nDecomposed;
                                // What the PDF stores is not what a person
                                // calls the page's objects — but that reading
                                // is the host's now: an editor with a host asks
                                // for the page's raw model (.uno:PdfPageModel
                                // raw=1) and builds the host's analysis of it
                                // (BuildPdfPageModel). This verb is the fallback
                                // without a host, and it leaves the importer's
                                // objects as they are.
                                // Tell EVERY view the page changed. The model
                                // broadcasts alone do not reach the clients
                                // here: the imported objects arrive through
                                // NbcInsertObject (no broadcast), and the
                                // removed graphic's ObjectRemoved hint carries
                                // its LAST bound rect, which a vector-rendering
                                // kit that never painted the page leaves
                                // empty - so nothing invalidated, and a client
                                // kept its picture payload until something
                                // else repainted (slot-03, 2026-09-03: the page
                                // decomposed in the model, the canvas showed
                                // the flagged picture for 90 s). Whole-part
                                // invalidation, the way InsertTextBox/
                                // InsertShape announce their objects.
                                SfxViewShell* pThisView = &GetViewShellBase();
                                KitHelper::notifyInvalidation(pThisView, nPage, nullptr);
                                KitHelper::forEachOtherView(
                                    pThisView, [nPage](SfxViewShell* pOtherView) {
                                        KitHelper::notifyInvalidation(pOtherView, nPage,
                                                                      nullptr);
                                    });
                            }
                            if (nDecomposed == 0)
                                lcl_LogWarning(
                                    "FillApi SlideCmd DecomposePdfPages: no page graphic to decompose");
                        }

                        else if (aItem3.first == "BuildPdfPageModel")
                        {
                            // A PDF the one-pager skill made carries the
                            // editor's object model as an embedded file; the
                            // host serves it and the client hands it here as
                            // "<page>|<base64 json>". The page's objects are
                            // built from the model — the importer's own
                            // recipe with explicit attributes — and the
                            // protected page graphic is dropped, exactly as
                            // DecomposePdfPages does, but with no pdfium
                            // heuristics and no structuring pass: what the
                            // renderer measured is what the page shows. Undo
                            // and the modified flag stay untouched (opening
                            // is not an edit). A model that builds nothing
                            // leaves the graphic in place, so the client's
                            // decompose fallback still has a page to take apart.
                            const std::string aVal = aItem3.second.get_value<std::string>();
                            const size_t nBar = aVal.find('|');
                            int nPage = -1;
                            if (nBar != std::string::npos && nBar > 0)
                            {
                                try
                                {
                                    nPage = std::stoi(aVal.substr(0, nBar));
                                }
                                catch (const std::exception&)
                                {
                                    nPage = -1;
                                }
                            }
                            if (nPage < 0 || nPage >= nPageCount)
                            {
                                lcl_LogWarning("FillApi SlideCmd BuildPdfPageModel: malformed value "
                                               "(expected <page>|<base64 json>)");
                                continue;
                            }
                            boost::property_tree::ptree aModel;
                            bool bParsed = false;
                            {
                                cpo::uno::Sequence<sal_Int8> aBytes;
                                comphelper::Base64::decode(aBytes, std::string_view(aVal).substr(nBar + 1));
                                if (aBytes.hasElements())
                                {
                                    std::string aJson(reinterpret_cast<const char*>(aBytes.getConstArray()),
                                                      static_cast<size_t>(aBytes.getLength()));
                                    std::istringstream aModelStream(aJson);
                                    try
                                    {
                                        // Bounded before read_json recurses
                                        // into it (one level per nesting).
                                        if (!sd::pdfpage::JsonNestingWithin(
                                                aJson, sd::pdfpage::MODEL_MAX_JSON_NESTING))
                                            throw boost::property_tree::json_parser::
                                                json_parser_error("nested too deeply", "", 0);
                                        boost::property_tree::read_json(aModelStream, aModel);
                                        bParsed = true;
                                    }
                                    catch (const std::exception& e)
                                    {
                                        lcl_LogWarning(std::string("FillApi SlideCmd BuildPdfPageModel: "
                                                                   "model is not JSON: ")
                                                       + e.what());
                                    }
                                }
                                else
                                    lcl_LogWarning("FillApi SlideCmd BuildPdfPageModel: empty model");
                            }
                            if (!bParsed)
                                continue;
                            SdPage* pPage = GetDoc()->GetSdPage(static_cast<sal_uInt16>(nPage),
                                                                PageKind::Standard);
                            SdrGrafObj* pGraf = pPage ? pPage->GetPdfPageGraphic() : nullptr;
                            if (!pGraf)
                            {
                                lcl_LogWarning("FillApi SlideCmd BuildPdfPageModel: page "
                                               + std::to_string(nPage) + " has no page graphic");
                                continue;
                            }
                            // Restored however the block exits, as in
                            // DecomposePdfPages; the scratch import dies first
                            // (declared after the guard).
                            const bool bUndoEnabled = GetDoc()->IsUndoEnabled();
                            const bool bWasChanged = GetDoc()->IsChanged();
                            DrawDocShell* const pOpenDocShell = GetDocSh();
                            const bool bSetModifiedEnabled
                                = pOpenDocShell && pOpenDocShell->IsEnableSetModified();
                            GetDoc()->EnableUndo(false);
                            if (pOpenDocShell)
                                pOpenDocShell->EnableSetModified(false);
                            comphelper::ScopeGuard aOpenRestore(
                                [this, pOpenDocShell, bSetModifiedEnabled, bUndoEnabled,
                                 bWasChanged]()
                                {
                                    if (pOpenDocShell)
                                        pOpenDocShell->EnableSetModified(bSetModifiedEnabled);
                                    GetDoc()->EnableUndo(bUndoEnabled);
                                    GetDoc()->SetChanged(bWasChanged);
                                });
                            const size_t nGrafPos = pGraf->GetOrdNum();
                            const tools::Rectangle aFrame = pGraf->GetLogicRect();
                            // A model that points at importer objects (form
                            // controls, which it cannot express) gets them
                            // from a fresh import on a scratch page, by the
                            // ordinal the raw model gave them.
                            rtl::Reference<SdPage> xImported;
                            if (sd::pdfpage::ModelKeepsImportedObjects(aModel))
                            {
                                xImported = GetDoc()->AllocSdPage(false);
                                xImported->SetSize(pPage->GetSize());
                                SdrEditView::ImportPdfGraphic(*pGraf, *xImported, 0,
                                                              sd::pdfpage::SharedImportFonts(*pGraf));
                            }
                            const sd::pdfpage::ModelBuildStats aBuilt = sd::pdfpage::BuildPdfPageModel(
                                *GetDoc(), *pPage, aFrame, nGrafPos + 1, aModel, xImported.get());
                            if (aBuilt.built() == 0)
                            {
                                lcl_LogWarning("FillApi SlideCmd BuildPdfPageModel: page "
                                               + std::to_string(nPage) + ": " + aBuilt.sError);
                                continue;
                            }
                            pPage->RemoveObject(nGrafPos);
                            SfxViewShell* pThisView = &GetViewShellBase();
                            KitHelper::notifyInvalidation(pThisView, nPage, nullptr);
                            KitHelper::forEachOtherView(
                                pThisView, [nPage](SfxViewShell* pOtherView) {
                                    KitHelper::notifyInvalidation(pOtherView, nPage, nullptr);
                                });
                            if (aBuilt.nSkipped)
                                lcl_LogWarning("FillApi SlideCmd BuildPdfPageModel: page "
                                               + std::to_string(nPage) + ": "
                                               + std::to_string(aBuilt.nSkipped)
                                               + " model entries could not be built");
                        }
                        else if (aItem3.first == "AddWebFont")
                        {
                            // A decomposed PDF names each run's font by the
                            // family the PDF carries. The client downloads any
                            // family the image does not ship (from Google
                            // Fonts) and hands the full TTF here, so the EDIT
                            // re-flow lays text out in the real font instead of
                            // a wider generic substitute (the balloon). This is
                            // the full-font path - not the embedded glyph
                            // SUBSET (that reconstruction is what crashes, and
                            // is skipped on import) - so AddTempDevFont, which
                            // the document-embedded-fonts path itself uses, is
                            // safe. Registered under the wire family name so the
                            // object's font attribute resolves to it. Fail-open:
                            // a malformed value or a failed add leaves the
                            // fallback in place and never aborts the batch.
                            // Value: "<fontName>|<base64 ttf>".
                            const std::string aVal
                                = aItem3.second.get_value<std::string>();
                            const size_t nBar = aVal.find('|');
                            OutputDevice* pDevice = Application::GetDefaultDevice();
                            if (nBar == std::string::npos || nBar == 0
                                || nBar + 1 >= aVal.size() || !pDevice)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd AddWebFont: malformed value "
                                    "or no device");
                            }
                            else
                            {
                                const OUString aFontName = OUString::fromUtf8(
                                    std::string_view(aVal).substr(0, nBar));
                                // A FAMILY is not one font. Arial arrives as
                                // four faces, and asking only whether the
                                // FAMILY is available registered the first and
                                // dropped the rest — so bold and italic text
                                // was laid out in the regular face, which for
                                // an embedded subset holds none of its glyphs
                                // and loses the text entirely. Skip only a
                                // face already registered from these exact
                                // bytes; the payload identifies itself, so
                                // name plus length separates the faces.
                                static std::set<OUString> aRegisteredFaces;
                                const OUString aFaceKey
                                    = aFontName + ":"
                                      + OUString::number(
                                          static_cast<sal_Int64>(aVal.size() - nBar));
                                // An installed family of the same NAME is not
                                // a reason to refuse either: a document's
                                // Arial is its own embedded subset, not the
                                // metric look-alike the image ships.
                                if (aRegisteredFaces.insert(aFaceKey).second)
                                {
                                    cpo::uno::Sequence<sal_Int8> aBytes;
                                    comphelper::Base64::decode(
                                        aBytes,
                                        std::string_view(aVal).substr(nBar + 1));
                                    // The temporary file is named per FACE,
                                    // not per family: four faces of Arial
                                    // would otherwise want one filename, and
                                    // the second write fails on a file that
                                    // already exists — leaving bold and
                                    // italic unregistered while the family
                                    // looked served. AddTempDevFont still
                                    // takes the FAMILY name; weight and slant
                                    // it reads from the file itself.
                                    // Named as its own OUString: the helper
                                    // takes string_views, which a
                                    // concatenation does not convert to.
                                    const OUString aFaceFile
                                        = aFontName + "-"
                                          + OUString::number(
                                              static_cast<sal_Int64>(aBytes.getLength()));
                                    OUString aUrl;
                                    if (aBytes.hasElements())
                                        aUrl = EmbeddedFontsManager::
                                            getFileUrlForTemporaryFont(aFaceFile, u".ttf");
                                    osl::File aFile(aUrl);
                                    if (aBytes.hasElements() && !aUrl.isEmpty()
                                        && aFile.open(osl_File_OpenFlag_Write
                                                      | osl_File_OpenFlag_Create)
                                               == osl::File::E_None)
                                    {
                                        sal_uInt64 nWritten = 0;
                                        aFile.write(
                                            aBytes.getConstArray(),
                                            static_cast<sal_uInt64>(
                                                aBytes.getLength()),
                                            nWritten);
                                        aFile.close();
                                        if (!pDevice->AddTempDevFont(aUrl,
                                                                     aFontName))
                                            lcl_LogWarning(
                                                "FillApi SlideCmd AddWebFont: "
                                                "AddTempDevFont failed");
                                        else
                                        {
                                            // A font added this way is not
                                            // seen by the font caches that
                                            // already resolved the family to
                                            // a fallback; refresh them the
                                            // way the embedded-fonts path
                                            // does, or the kit keeps laying
                                            // out in the fallback.
                                            OutputDevice::ImplClearAllFontData(true);
                                            OutputDevice::ImplRefreshAllFontData(true);
                                        }
                                    }
                                    else
                                        lcl_LogWarning(
                                            "FillApi SlideCmd AddWebFont: "
                                            "decode/write failed");
                                }
                            }
                        }

                        else if (aItem3.first == "MarkObjects")
                        {
                            // Mark the listed objects (comma-separated page
                            // indices) so the selection-scoped UNO verbs -
                            // align, distribute, group, z-order - compose in
                            // batches exactly like a user's multi-select.
                            // The counterpart of UnmarkAll.
                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);
                            SdrPageView* pPageView = mpDrawView->GetSdrPageView();
                            const int nObjCount
                                = static_cast<int>(pPageStandard->GetObjCount());
                            std::stringstream aList(
                                aItem3.second.get_value<std::string>());
                            std::string aToken;
                            while (std::getline(aList, aToken, ','))
                            {
                                int nObjId = -1;
                                try
                                {
                                    nObjId = stoi(aToken);
                                }
                                catch (const std::exception&)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd MarkObjects: invalid index '"
                                        + aToken + "'");
                                    continue;
                                }
                                if (nObjId < 0 || nObjId >= nObjCount)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd MarkObjects: index out of range '"
                                        + aToken + "' (Object Count = "
                                        + std::to_string(nObjCount) + ")");
                                    continue;
                                }
                                SdrObject* pSdrObj = pPageStandard->GetObj(nObjId);
                                if (pSdrObj && pPageView)
                                    mpDrawView->MarkObj(pSdrObj, pPageView);
                            }
                        }
                        else if (aItem3.first == "MarkCreated")
                        {
                            // Mark objects created EARLIER IN THIS BATCH by
                            // their index in creation order. Lets one batch
                            // insert a scaffold and group it atomically -
                            // one list action, ONE undo - without a client
                            // round-trip for the created ordNums. Identity-
                            // based: unlike MarkObjects' page indices, the
                            // references stay valid across FormatGroup
                            // renumbering. Lazy like MarkObjects: JumpToSlide
                            // to the target page first.
                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);
                            SdrPageView* pPageView = mpDrawView->GetSdrPageView();
                            std::stringstream aList(
                                aItem3.second.get_value<std::string>());
                            std::string aToken;
                            while (std::getline(aList, aToken, ','))
                            {
                                int nCreatedId = -1;
                                try
                                {
                                    nCreatedId = stoi(aToken);
                                }
                                catch (const std::exception&)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd MarkCreated: invalid index '"
                                        + aToken + "'");
                                    continue;
                                }
                                if (nCreatedId < 0
                                    || static_cast<size_t>(nCreatedId)
                                           >= aCreatedSdrObjects.size())
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd MarkCreated: index out of range '"
                                        + aToken + "' (created = "
                                        + std::to_string(aCreatedSdrObjects.size()) + ")");
                                    continue;
                                }
                                SdrObject* pSdrObj = aCreatedSdrObjects[nCreatedId];
                                if (pSdrObj->getSdrPageFromSdrObject() != pPageStandard)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd MarkCreated: object '" + aToken
                                        + "' is not on the current page");
                                    continue;
                                }
                                // Resolve to the TOP-LEVEL container: after an
                                // earlier FormatGroup in this batch the leaf
                                // lives inside a group, and marking the leaf's
                                // outermost ancestor is what lets one batch
                                // build LAYERED groups (cards, then the row of
                                // cards) - a second FormatGroup over one
                                // representative leaf per card groups the
                                // card-groups themselves.
                                while (SdrObject* pParent
                                       = pSdrObj->getParentSdrObjectFromSdrObject())
                                    pSdrObj = pParent;
                                if (pPageView)
                                    mpDrawView->MarkObj(pSdrObj, pPageView);
                            }
                        }
                        else if (aItem3.first == "MatchSizes")
                        {
                            // Equalize the listed objects to the LARGEST
                            // width and height among them, keeping each
                            // position - "whatever the longest block is, the
                            // rest should be the same size as that one".
                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);
                            const int nObjCount
                                = static_cast<int>(pPageStandard->GetObjCount());
                            std::vector<SdrObject*> aTargets;
                            std::stringstream aList(
                                aItem3.second.get_value<std::string>());
                            std::string aToken;
                            while (std::getline(aList, aToken, ','))
                            {
                                int nObjId = -1;
                                try
                                {
                                    nObjId = stoi(aToken);
                                }
                                catch (const std::exception&)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd MatchSizes: invalid index '"
                                        + aToken + "'");
                                    continue;
                                }
                                if (nObjId < 0 || nObjId >= nObjCount)
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd MatchSizes: index out of range '"
                                        + aToken + "' (Object Count = "
                                        + std::to_string(nObjCount) + ")");
                                    continue;
                                }
                                if (SdrObject* pSdrObj = pPageStandard->GetObj(nObjId))
                                {
                                    // Rotated/sheared objects are excluded
                                    // ENTIRELY: their axis-aligned snap rect
                                    // would donate an inflated target size to
                                    // the rest (review F4), and applying to
                                    // them shears/corrupts (review F2).
                                    if (pSdrObj->GetRotateAngle() != 0_deg100
                                        || pSdrObj->GetShearAngle() != 0_deg100)
                                    {
                                        lcl_LogWarning(
                                            "FillApi SlideCmd MatchSizes: skipping rotated/sheared object");
                                        continue;
                                    }
                                    aTargets.push_back(pSdrObj);
                                }
                            }
                            if (aTargets.size() >= 2)
                            {
                                ::tools::Long nMaxW = 0;
                                ::tools::Long nMaxH = 0;
                                for (SdrObject* pSdrObj : aTargets)
                                {
                                    const ::tools::Rectangle aRect = pSdrObj->GetSnapRect();
                                    nMaxW = std::max(nMaxW, aRect.GetWidth());
                                    nMaxH = std::max(nMaxH, aRect.GetHeight());
                                }
                                for (SdrObject* pSdrObj : aTargets)
                                {
                                    ::tools::Rectangle aRect = pSdrObj->GetSnapRect();
                                    if (aRect.GetWidth() == nMaxW
                                        && aRect.GetHeight() == nMaxH)
                                        continue;
                                    if (pBatchUndoManager)
                                        pBatchUndoManager->AddUndoAction(
                                            GetDoc()->GetSdrUndoFactory().CreateUndoGeoObject(
                                                *pSdrObj));
                                    aRect.SetSize(Size(nMaxW, nMaxH));
                                    pSdrObj->SetSnapRect(aRect);
                                }
                            }
                        }
                        else if (aItem3.first.starts_with("EditTextObject."))
                        {
                            int nObjId = stoi(aItem3.first.substr(15));
                            SdPage* pPageStandard
                                = GetDoc()->GetSdPage(nActPageId, PageKind::Standard);
                            int nObjCount = pPageStandard->GetObjCount();
                            if (nObjId < 0)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd EditTextObject: Object idx < 0. '"
                                    + aItem3.first + "'");
                            }
                            else if (nObjId >= nObjCount)
                            {
                                lcl_LogWarning(
                                    "FillApi SlideCmd EditTextObject: Object idx >= "
                                    "Object Count. '"
                                    + aItem3.first
                                    + "' (Object Count = " + std::to_string(nObjCount) + ")");
                            }
                            else
                            {
                                SdrObject* pSdrObj = pPageStandard->GetObj(nObjId);
                                if (!pSdrObj->IsSdrTextObj())
                                {
                                    lcl_LogWarning(
                                        "FillApi SlideCmd EditTextObject: Object is "
                                        "not a TextObject. '"
                                        + aItem3.first + "'");
                                }
                                else
                                {
                                    SdrTextObj* pSdrTxt = static_cast<SdrTextObj*>(pSdrObj);
                                    SdrView* pView1 = GetView();
                                    pView1->MarkObj(pSdrTxt, pView1->GetSdrPageView());
                                    pView1->SdrBeginTextEdit(pSdrTxt);
                                    EditView& rEditView
                                        = pView1->GetTextEditOutlinerView()->GetEditView();
                                    for (const auto& aItem4Obj : aItem3.second)
                                    {
                                        const auto& aItem4
                                            = aItem4Obj.first == ""
                                                  ? *aItem4Obj.second.ordered_begin()
                                                  : aItem4Obj;

                                        if (aItem4.first == "SelectText")
                                        {
                                            std::vector<int> aValues;
                                            for (const auto& aItem5 : aItem4.second)
                                            {
                                                //if == last?
                                                aValues.push_back(aItem5.second.get_value<int>());
                                            }
                                            if (aValues.size() == 0)
                                            {
                                                //select the whole text
                                                aValues.push_back(0);
                                                aValues.push_back(0);
                                                aValues.push_back(EE_PARA_MAX);
                                                aValues.push_back(EE_TEXTPOS_MAX);
                                            }
                                            else if (aValues.size() == 1)
                                            {
                                                //select the paragraph
                                                aValues.push_back(0);
                                                aValues.push_back(aValues[0]);
                                                aValues.push_back(EE_TEXTPOS_MAX);
                                            }
                                            else if (aValues.size() == 2)
                                            {
                                                // set the cursor without selecting anything
                                                aValues.push_back(aValues[0]);
                                                aValues.push_back(aValues[1]);
                                            }
                                            else if (aValues.size() == 3)
                                            {
                                                aValues.push_back(EE_TEXTPOS_MAX);
                                            }

                                            const ESelection rNewSel(aValues[0], aValues[1],
                                                                     aValues[2], aValues[3]);
                                            rEditView.SetSelection(rNewSel);
                                        }
                                        else if (aItem4.first == "SelectParagraph")
                                        {
                                            int nParaId = aItem4.second.get_value<int>();

                                            const ESelection rNewSel(nParaId, 0, nParaId,
                                                                     EE_TEXTPOS_MAX);
                                            rEditView.SetSelection(rNewSel);
                                        }
                                        else if (aItem4.first == "InsertText")
                                        {
                                            OUString aText = OStringToOUString(
                                                aItem4.second.get_value<std::string>(),
                                                RTL_TEXTENCODING_UTF8);
                                            // It select the inserted text also
                                            rEditView.InsertText(aText, true);
                                        }
                                        else if (aItem4.first == "UnoCommand")
                                        {
                                            std::string aText
                                                = aItem4.second.get_value<std::string>();
                                            lcl_UnoCommand(aText);
                                        }
                                    }
                                    pView1->SdrEndTextEdit();
                                }
                            }
                        }
                        else if (aItem3.first == "UnoCommand")
                        {
                            std::string aText = aItem3.second.get_value<std::string>();
                            lcl_UnoCommand(aText);
                        }
                    }

                    // A trailing bare JumpToSlide/JumpToSlideByName is the
                    // one sanctioned way for a batch to navigate the user's
                    // view. Its page switch is normally applied lazily at
                    // the head of the NEXT command, so flush it here.
                    if ((aLastCommandKey == "JumpToSlide"
                         || aLastCommandKey == "JumpToSlideByName")
                        && nActPageId != nNextPageId)
                    {
                        SwitchPage(static_cast<sal_uInt16>(nNextPageId),
                                   /*bAllowChangeFocus=*/false);
                    }
                }
            }
        }
        else if (aItem.first == "UnoCommand")
        {
            KitHelper::dispatchUnoCommand(aItem.second);
        }
    }
    }
    catch (...)
    {
        if (!aResponseChannel)
            throw;
        lcl_LogWarning("FillApi Transform failed; returning correlated broker failure.");
        bSuccess = false;
    }

    // Agent batches must not hijack the user's view (the co-working
    // contract): unless the batch explicitly ended in a bare JumpToSlide /
    // JumpToSlideByName, return the view to the PAGE it was on at entry.
    // The entry page is found by identity (deck-mutating commands renumber
    // positions); a deleted entry page falls back to its old position,
    // clamped. Page edit mode only - see the capture site.
    if (bEntryPageMode
        && aLastCommandKey != "JumpToSlide" && aLastCommandKey != "JumpToSlideByName")
    {
        const sal_uInt16 nRestorePageCount
            = GetDoc()->GetSdPageCount(PageKind::Standard);
        sal_uInt16 nRestorePageId = nEntryPageId;
        bool bFound = false;
        for (sal_uInt16 nPos = 0; pEntryPage && nPos < nRestorePageCount; ++nPos)
        {
            if (GetDoc()->GetSdPage(nPos, PageKind::Standard) == pEntryPage)
            {
                nRestorePageId = nPos;
                bFound = true;
                break;
            }
        }
        if (!bFound && nRestorePageCount > 0 && nRestorePageId >= nRestorePageCount)
            nRestorePageId = nRestorePageCount - 1;
        if (maTabControl->GetCurPagePos() != nRestorePageId)
            SwitchPage(nRestorePageId, /*bAllowChangeFocus=*/false);
    }

    // Build a JSON result so the caller knows what happened.
    tools::JsonWriter aJson;
    aJson.put("success", bSuccess);
    if (aRequestId)
        aJson.put("requestId", *aRequestId);
    if (bHasSpeakerNotesSlideId)
        aJson.put("slideId", nSpeakerNotesSlideId);
    if (aResponseChannel)
        aJson.put("responseChannel", *aResponseChannel);
    if (!aWarnings.getWarnings().empty())
    {
        auto aNode = aJson.startArray("warnings");
        for (const auto& rWarn : aWarnings.getWarnings())
            aJson.putSimpleValue(OUString::fromUtf8(rWarn));
    }
    if (!aCreatedObjects.empty())
    {
        auto aNode = aJson.startArray("createdObjects");
        for (const auto& rCreated : aCreatedObjects)
        {
            auto aObjNode = aJson.startStruct();
            aJson.put("slide", rCreated.first);
            aJson.put("ordNum", static_cast<sal_Int64>(rCreated.second));
        }
    }
    rReq.SetReturnValue(SfxStringItem(FN_PARAM_1, OUString::fromUtf8(aJson.finishAndGetAsOString())));
}

/**
 * SfxRequests for temporary actions
 */

void DrawViewShell::FuTemporary(SfxRequest& rReq)
{
    DBG_ASSERT( mpDrawView, "sd::DrawViewShell::FuTemporary(), no draw view!" );
    if( !mpDrawView )
        return;

    CheckLineTo (rReq);

    DeactivateCurrentFunction();

    sal_uInt16 nSId = rReq.GetSlot();
    const SdrMarkList& rMarkList = mpDrawView->GetMarkedObjectList();

    switch ( nSId )
    {
        case SID_OUTLINE_TEXT_AUTOFIT:
        {
            SfxUndoManager* pUndoManager = GetDocSh()->GetUndoManager();
            if( rMarkList.GetMarkCount() == 1 )
            {
                pUndoManager->EnterListAction(u""_ustr, u""_ustr, 0, GetViewShellBase().GetViewShellId());
                mpDrawView->BegUndo();

                SdrObject* pObj = rMarkList.GetMark(0)->GetMarkedSdrObj();
                bool bSet = pObj->GetMergedItemSet().GetItem<SdrTextFitToSizeTypeItem>(SDRATTR_TEXT_FITTOSIZE)->GetValue() != drawing::TextFitToSizeType_NONE;

                mpDrawView->AddUndo(GetDoc()->GetSdrUndoFactory().CreateUndoAttrObject(*pObj));

                if (!bSet)
                {
                    //If we are turning on AutoFit we have to turn these off if already on
                    if (pObj->GetMergedItemSet().GetItem<SdrOnOffItem>(SDRATTR_TEXT_AUTOGROWHEIGHT)->GetValue())
                        pObj->SetMergedItem(makeSdrTextAutoGrowHeightItem(false));
                    if (pObj->GetMergedItemSet().GetItem<SdrOnOffItem>(SDRATTR_TEXT_AUTOGROWWIDTH)->GetValue())
                        pObj->SetMergedItem(makeSdrTextAutoGrowWidthItem(false));
                }

                pObj->SetMergedItem(SdrTextFitToSizeTypeItem(bSet ? drawing::TextFitToSizeType_NONE : drawing::TextFitToSizeType_AUTOFIT));

                mpDrawView->EndUndo();
                pUndoManager->LeaveListAction();
            }
            Cancel();
            rReq.Done();
        }
        break;

        case SID_FIT_FRAME_TO_TEXT:
        {
            // One-shot frame-to-text fit (Vulcan fork): resize every marked
            // text frame to hug its text on both axes. The vertical text
            // insets are zeroed first so the fitted frame is the TEXT, not
            // text plus generator-baked padding; horizontal insets stay
            // (they set the wrap width). The persistent autogrow attributes
            // stay untouched. Wrapped in a view-tagged list action so the
            // requesting LOK view owns the single undo step (the ImpSidUndo
            // ownership check).
            SfxUndoManager* pUndoManager = GetDocSh()->GetUndoManager();
            const size_t nMarkCount = rMarkList.GetMarkCount();
            if (nMarkCount > 0 && !mpDrawView->IsTextEdit())
            {
                pUndoManager->EnterListAction(u""_ustr, u""_ustr, 0, GetViewShellBase().GetViewShellId());
                mpDrawView->BegUndo();
                for (size_t i = 0; i < nMarkCount; ++i)
                {
                    SdrObject* pObj = rMarkList.GetMark(i)->GetMarkedSdrObj();
                    SdrTextObj* pTextObj = DynCastSdrTextObj(pObj);
                    // Tables report HasText() unconditionally and expose one
                    // cell as active text - fitting or autogrow-toggling
                    // would relay the whole table from a single cell
                    // (review P1-6).
                    if (pTextObj
                        && pTextObj->GetObjIdentifier() == SdrObjKind::Table)
                        continue;
                    // Any text-bearing object: the selection is explicit
                    // intent, and pptx text boxes import as custom shapes
                    // (IsTextFrame() false), which is most of every deck.
                    if (!pTextObj || !pTextObj->HasText())
                        continue;
                    lcl_FitFrameHug(GetDoc(), pTextObj,
                        [this](std::unique_ptr<SdrUndoAction> pUndo)
                        { mpDrawView->AddUndo(std::move(pUndo)); });
                }
                mpDrawView->EndUndo();
                pUndoManager->LeaveListAction();
            }
            Cancel();
            rReq.Done();
        }
        break;

        case SID_TOGGLE_AUTO_WIDTH:
        case SID_TOGGLE_AUTO_HEIGHT:
        {
            // Per-box resize-mode toggle (Vulcan fork): flip the autogrow
            // attribute on one axis for every marked text object, empty
            // boxes included - the resize mode of a box about to be typed
            // into is the point of toggling it. Turning a mode ON also
            // zeroes the matching min-frame item (the floor AdaptTextMinSize
            // seeded from the drawn rectangle) so the box can shrink to its
            // content, and clears an active autofit first - the two
            // mechanisms are mutually exclusive, mirroring
            // SID_OUTLINE_TEXT_AUTOFIT above.
            const bool bWidth = (nSId == SID_TOGGLE_AUTO_WIDTH);
            SfxUndoManager* pUndoManager = GetDocSh()->GetUndoManager();
            const size_t nMarkCount = rMarkList.GetMarkCount();
            if (nMarkCount > 0 && !mpDrawView->IsTextEdit())
            {
                pUndoManager->EnterListAction(u""_ustr, u""_ustr, 0, GetViewShellBase().GetViewShellId());
                mpDrawView->BegUndo();
                for (size_t i = 0; i < nMarkCount; ++i)
                {
                    SdrObject* pObj = rMarkList.GetMark(i)->GetMarkedSdrObj();
                    SdrTextObj* pTextObj = DynCastSdrTextObj(pObj);
                    // Tables report HasText() unconditionally and expose one
                    // cell as active text - fitting or autogrow-toggling
                    // would relay the whole table from a single cell
                    // (review P1-6).
                    if (pTextObj
                        && pTextObj->GetObjIdentifier() == SdrObjKind::Table)
                        continue;
                    // Pictures and OLE objects derive from SdrRectObj, so
                    // the cast alone admits them - require a text frame or
                    // carried text, or the toggle records a do-nothing
                    // undo step. Empty TEXT FRAMES stay toggleable.
                    if (!pTextObj
                        || (!pTextObj->IsTextFrame() && !pTextObj->HasText()))
                        continue;
                    // Geometry first, attributes second: undo runs in
                    // reverse, so the exact old rectangle is restored after
                    // the attribute restore re-triggers auto-adjustment.
                    mpDrawView->AddUndo(GetDoc()->GetSdrUndoFactory().CreateUndoGeoObject(*pTextObj));
                    mpDrawView->AddUndo(GetDoc()->GetSdrUndoFactory().CreateUndoAttrObject(*pTextObj));
                    const SfxItemSet& rObjSet = pTextObj->GetMergedItemSet();
                    const bool bOn = bWidth
                        ? !rObjSet.GetItem<SdrOnOffItem>(SDRATTR_TEXT_AUTOGROWWIDTH)->GetValue()
                        : !rObjSet.GetItem<SdrOnOffItem>(SDRATTR_TEXT_AUTOGROWHEIGHT)->GetValue();
                    if (bOn && rObjSet.GetItem<SdrTextFitToSizeTypeItem>(SDRATTR_TEXT_FITTOSIZE)->GetValue() != drawing::TextFitToSizeType_NONE)
                        pTextObj->SetMergedItem(SdrTextFitToSizeTypeItem(drawing::TextFitToSizeType_NONE));
                    if (bWidth)
                        pTextObj->SetMergedItem(makeSdrTextAutoGrowWidthItem(bOn));
                    else
                        pTextObj->SetMergedItem(makeSdrTextAutoGrowHeightItem(bOn));
                    if (bOn)
                    {
                        // Zero the floor AFTER the autogrow flip: enabling
                        // the mode on a custom shape reseeds the minimum
                        // from the current rect (AdaptTextMinSize), which
                        // the zero must outlive.
                        if (bWidth)
                            pTextObj->SetMergedItem(makeSdrTextMinFrameWidthItem(0));
                        else
                            pTextObj->SetMergedItem(makeSdrTextMinFrameHeightItem(0));
                    }
                    pTextObj->AdjustTextFrameWidthAndHeight();
                    // Custom shapes (every pptx text box) return early from
                    // SdrTextObj's frame adjustment (mbTextFrame false), so
                    // an enabling toggle would flip the attribute with no
                    // visible effect. Settle the enabled axis explicitly;
                    // the geometry undo above already covers it.
                    if (bOn && !pTextObj->IsTextFrame() && pTextObj->HasText())
                    {
                        const Size aFitSize = pTextObj->CalcFitToTextSize();
                        if (!aFitSize.IsEmpty())
                        {
                            ::tools::Rectangle aFitRect = pTextObj->GetLogicRect();
                            if (bWidth)
                                aFitRect.SetSize(Size(aFitSize.Width(), aFitRect.GetHeight()));
                            else
                                aFitRect.SetSize(Size(aFitRect.GetWidth(), aFitSize.Height()));
                            if (aFitRect != pTextObj->GetLogicRect())
                                pTextObj->SetLogicRect(aFitRect);
                        }
                    }
                }
                mpDrawView->EndUndo();
                pUndoManager->LeaveListAction();
            }
            Cancel();
            rReq.Done();
        }
        break;

        // area and line attributes: shall have
        // an own Execute method (like StateMethode)
        case SID_ATTR_FILL_STYLE:
        case SID_ATTR_FILL_COLOR:
        case SID_ATTR_FILL_GRADIENT:
        case SID_ATTR_FILL_HATCH:
        case SID_ATTR_FILL_BITMAP:
        case SID_ATTR_FILL_SHADOW:
        case SID_ATTR_SHADOW_COLOR:
        case SID_ATTR_SHADOW_TRANSPARENCE:
        case SID_ATTR_SHADOW_BLUR:
        case SID_ATTR_SHADOW_XDISTANCE:
        case SID_ATTR_SHADOW_YDISTANCE:
        case SID_ATTR_FILL_USE_SLIDE_BACKGROUND:
        case SID_ATTR_FILL_TRANSPARENCE:
        case SID_ATTR_FILL_FLOATTRANSPARENCE:

        case SID_ATTR_LINE_STYLE:
        case SID_ATTR_LINE_DASH:
        case SID_ATTR_LINE_WIDTH:
        case SID_ATTR_LINE_COLOR:
        case SID_ATTR_LINEEND_STYLE:
        case SID_ATTR_LINE_START:
        case SID_ATTR_LINE_END:
        case SID_ATTR_LINE_TRANSPARENCE:
        case SID_ATTR_LINE_JOINT:
        case SID_ATTR_LINE_CAP:

        case SID_ATTR_TEXT_FITTOSIZE:
        {
            if( rReq.GetArgs() )
            {
                std::unique_ptr<SfxItemSet> pNewArgs = rReq.GetArgs()->Clone();
                lcl_convertStringArguments(nSId, pNewArgs);
                mpDrawView->SetAttributes(*pNewArgs);
                rReq.Done();
            }
            else
            {
                switch( rReq.GetSlot() )
                {
                    case SID_ATTR_FILL_SHADOW:
                    case SID_ATTR_SHADOW_COLOR:
                    case SID_ATTR_SHADOW_TRANSPARENCE:
                    case SID_ATTR_SHADOW_BLUR:
                    case SID_ATTR_SHADOW_XDISTANCE:
                    case SID_ATTR_SHADOW_YDISTANCE:
                    case SID_ATTR_FILL_STYLE:
                    case SID_ATTR_FILL_COLOR:
                    case SID_ATTR_FILL_GRADIENT:
                    case SID_ATTR_FILL_HATCH:
                    case SID_ATTR_FILL_BITMAP:
                    case SID_ATTR_FILL_USE_SLIDE_BACKGROUND:
                    case SID_ATTR_FILL_TRANSPARENCE:
                    case SID_ATTR_FILL_FLOATTRANSPARENCE:
                        GetViewFrame()->GetDispatcher()->Execute( SID_ATTRIBUTES_AREA, SfxCallMode::ASYNCHRON );
                        break;
                    case SID_ATTR_LINE_STYLE:
                    case SID_ATTR_LINE_DASH:
                    case SID_ATTR_LINE_WIDTH:
                    case SID_ATTR_LINE_COLOR:
                    case SID_ATTR_LINE_TRANSPARENCE:
                    case SID_ATTR_LINE_JOINT:
                    case SID_ATTR_LINE_CAP:
                        GetViewFrame()->GetDispatcher()->Execute( SID_ATTRIBUTES_LINE, SfxCallMode::ASYNCHRON );
                        break;
                    case SID_ATTR_TEXT_FITTOSIZE:
                        GetViewFrame()->GetDispatcher()->Execute( SID_TEXTATTR_DLG, SfxCallMode::ASYNCHRON );
                        break;
                }
            }
            Cancel();
        }
        break;

        case SID_HYPHENATION:
        {
            const SfxBoolItem* pItem = rReq.GetArg<SfxBoolItem>(SID_HYPHENATION);

            if( pItem )
            {
                SfxItemSetFixed<EE_PARA_HYPHENATE, EE_PARA_HYPHENATE> aSet( GetPool() );
                bool bValue = pItem->GetValue();
                aSet.Put( SfxBoolItem( EE_PARA_HYPHENATE, bValue ) );
                mpDrawView->SetAttributes( aSet );
            }
            else // only for testing purpose
            {
                OSL_FAIL(" no value for hyphenation!");
                SfxItemSetFixed<EE_PARA_HYPHENATE, EE_PARA_HYPHENATE> aSet( GetPool() );
                aSet.Put( SfxBoolItem( EE_PARA_HYPHENATE, true ) );
                mpDrawView->SetAttributes( aSet );
            }
            rReq.Done();
            Cancel();
        }
        break;

        case FN_TRANSFORM_DOCUMENT_STRUCTURE:
        {
            FuTransformDocumentStructure(rReq);
            rReq.Done();
            // Every sibling case ends with Cancel(): it disposes the
            // request's temporary function and RE-ACTIVATES the permanent
            // FuSelection. This was the only case that skipped it, and the
            // slot bisect pinned the fallout: after ANY interactive batch —
            // even an empty one — rubber-band marking was dead for the rest
            // of the session (clicks still worked, marquee never did).
            Cancel();
        }
        break;

        case SID_INSERTPAGE:
        case SID_INSERTPAGE_QUICK:
        {
            SdPage* pNewPage = CreateOrDuplicatePage (rReq, mePageKind, GetActualPage());
            Cancel();
            if(HasCurrentFunction(SID_BEZIER_EDIT) )
                GetViewFrame()->GetDispatcher()->Execute(SID_OBJECT_SELECT, SfxCallMode::ASYNCHRON);
            if (pNewPage != nullptr)
                SwitchPage((pNewPage->GetPageNum()-1)/2);
            rReq.Done ();
        }
        break;
        case SID_INSERT_CANVAS_SLIDE:
        {
            sal_uInt16 nCanvasPageIndex = GetDoc()->GetOrInsertCanvasPage();
            Cancel(); // Don't know what this does
            SwitchPage(nCanvasPageIndex);
            GetDoc()->NotifyKitHasOverviewPage(true);
            rReq.Done();
        }
        break;

        case SID_SHUFFLE_PAGES:
        {
            if (!GetDoc()->HasCanvasPage())
                break;
            GetDoc()->ReshufflePages();
            Cancel();
            rReq.Done();
        }
        break;

        case SID_DUPLICATE_PAGE:
        {
            auto slideSorter = sd::slidesorter::SlideSorterViewShell::GetSlideSorter(GetViewShellBase());
            SdPage* pNewPage = nullptr;
            if(slideSorter)
                DuplicateSelectedSlides(rReq);
            else
                pNewPage = CreateOrDuplicatePage (rReq, mePageKind, GetActualPage());
            Cancel();
            if(HasCurrentFunction(SID_BEZIER_EDIT) )
                GetViewFrame()->GetDispatcher()->Execute(SID_OBJECT_SELECT, SfxCallMode::ASYNCHRON);
            if(!slideSorter && pNewPage != nullptr)
                SwitchPage((pNewPage->GetPageNum()-1)/2);
            rReq.Done();
        }
        break;

        case SID_INSERT_MASTER_PAGE:
        {
            // Use the API to create a new page.
            rtl::Reference<SdXImpressDocument> xMasterPagesSupplier (
                GetDoc()->getUnoModel());
            if (xMasterPagesSupplier.is())
            {
                Reference<drawing::XDrawPages> xMasterPages (
                    xMasterPagesSupplier->getMasterPages());
                if (xMasterPages.is())
                {
                    sal_uInt16 nIndex = GetCurPagePos() + 1;
                    xMasterPages->insertNewByIndex (nIndex);

                    // Create shapes for the default layout.
                    SdPage* pMasterPage = GetDoc()->GetMasterSdPage(
                        nIndex, PageKind::Standard);
                    pMasterPage->CreateTitleAndLayout (true,true);
                }
            }

            Cancel();
            if(HasCurrentFunction(SID_BEZIER_EDIT))
                GetViewFrame()->GetDispatcher()->Execute(
                    SID_OBJECT_SELECT, SfxCallMode::ASYNCHRON);
            rReq.Done ();
        }
        break;

        case SID_MODIFYPAGE:
        {
            if (mePageKind==PageKind::Standard || mePageKind==PageKind::Notes ||
                (mePageKind==PageKind::Handout && meEditMode==EditMode::MasterPage) )
            {
                if ( mpDrawView->IsTextEdit() )
                {
                    mpDrawView->SdrEndTextEdit();
                }
                sal_uInt16 nPage = maTabControl->GetCurPagePos();
                mpActualPage = GetDoc()->GetSdPage(nPage, mePageKind);
                ::sd::ViewShell::mpImpl->ProcessModifyPageSlot (
                    rReq,
                    mpActualPage,
                    mePageKind);
            }

            Cancel();
            rReq.Done ();
        }
        break;

        case SID_ASSIGN_LAYOUT:
        {
            if (mePageKind==PageKind::Standard || mePageKind==PageKind::Notes || (mePageKind==PageKind::Handout && meEditMode==EditMode::MasterPage))
            {
                if ( mpDrawView->IsTextEdit() )
                    mpDrawView->SdrEndTextEdit();

                ::sd::ViewShell::mpImpl->AssignLayout(rReq, mePageKind);
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_RENAMEPAGE:
        case SID_RENAME_MASTER_PAGE:
        {
            if (mePageKind==PageKind::Standard || mePageKind==PageKind::Notes )
            {
                if ( mpDrawView->IsTextEdit() )
                {
                    mpDrawView->SdrEndTextEdit();
                }

                sal_uInt16 nPage = maTabControl->GetCurPagePos();
                SdPage* pCurrentPage = ( GetEditMode() == EditMode::Page )
                    ? GetDoc()->GetSdPage( nPage, GetPageKind() )
                    : GetDoc()->GetMasterSdPage( nPage, GetPageKind() );

                OUString aTitle = SdResId(STR_TITLE_RENAMESLIDE);
                OUString aDescr = SdResId(STR_DESC_RENAMESLIDE);
                const OUString& aPageName = pCurrentPage->GetName();

                if(rReq.GetArgs())
                {
                    OUString aName = rReq.GetArgs()->GetItem<const SfxStringItem>(SID_RENAMEPAGE)->GetValue();

                    bool bResult = RenameSlide( maTabControl->GetPageId(nPage), aName );
                    DBG_ASSERT( bResult, "Couldn't rename slide" );
                }
                else
                {
                    SvxAbstractDialogFactory* pFact = SvxAbstractDialogFactory::Create();
                    ScopedVclPtr<AbstractSvxNameDialog> aNameDlg(pFact->CreateSvxNameDialog(GetFrameWeld(), aPageName, aDescr));
                    aNameDlg->SetText( aTitle );
                    aNameDlg->SetCheckNameHdl( LINK( this, DrawViewShell, RenameSlideHdl ) );
                    aNameDlg->SetEditHelpId( HID_SD_NAMEDIALOG_PAGE );

                    if( aNameDlg->Execute() == RET_OK )
                    {
                        OUString aNewName = aNameDlg->GetName();
                        if (aNewName != aPageName)
                        {
                            bool bResult = RenameSlide( maTabControl->GetPageId(nPage), aNewName );
                            DBG_ASSERT( bResult, "Couldn't rename slide" );
                        }
                    }
                }
            }
            Cancel();
            rReq.Ignore();
        }
        break;

        case SID_RENAMEPAGE_QUICK:
        {
            if (mePageKind==PageKind::Standard || mePageKind==PageKind::Notes )
            {
                if ( mpDrawView->IsTextEdit() )
                {
                    mpDrawView->SdrEndTextEdit();
                }

                maTabControl->StartEditMode( maTabControl->GetCurPageId() );
            }

            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_ADD_SLIDE_SECTION:
        {
            SdPage* pPage = GetActualPage();
            if (pPage)
            {
                sal_uInt16 nPage = (pPage->GetPageNum() - 1) / 2;
                sd::SlideSectionManager& rMgr = GetDoc()->GetSectionManager();
                auto pUndo = GetDoc()->IsUndoEnabled()
                    ? std::make_unique<sd::UndoSlideSection>(
                          *GetDoc(), SdResId(STR_UNDO_ADD_SLIDE_SECTION))
                    : nullptr;
                rMgr.AddSection(nPage, SdResId(STR_DEFAULT_SLIDE_SECTION_NAME));
                if (pUndo)
                    GetDoc()->AddUndo(std::move(pUndo));
                GetDocSh()->SetModified();
            }
        }
        break;

        case SID_REMOVE_SLIDE_SECTION:
        {
            SdPage* pPage = GetActualPage();
            if (pPage)
            {
                sal_uInt16 nPage = (pPage->GetPageNum() - 1) / 2;
                sd::SlideSectionManager& rMgr = GetDoc()->GetSectionManager();
                sal_Int32 nSectionIdx = rMgr.GetSectionIndexForSlide(nPage);
                if (nSectionIdx >= 0 && rMgr.IsSectionStart(nPage))
                {
                    auto pUndo = GetDoc()->IsUndoEnabled()
                        ? std::make_unique<sd::UndoSlideSection>(
                              *GetDoc(), SdResId(STR_UNDO_REMOVE_SLIDE_SECTION))
                        : nullptr;
                    rMgr.RemoveSection(nSectionIdx);
                    if (pUndo)
                        GetDoc()->AddUndo(std::move(pUndo));
                    GetDocSh()->SetModified();
                }
            }
        }
        break;

        case SID_REMOVE_SLIDE_SECTION_AND_SLIDES:
        {
            SdPage* pPage = GetActualPage();
            if (pPage)
            {
                sal_uInt16 nPage = (pPage->GetPageNum() - 1) / 2;
                sd::SlideSectionManager& rMgr = GetDoc()->GetSectionManager();
                sal_Int32 nSectionIdx = rMgr.GetSectionIndexForSlide(nPage);
                if (nSectionIdx >= 0 && rMgr.IsSectionStart(nPage))
                {
                    const bool bUndo = GetDoc()->IsUndoEnabled();
                    if (bUndo)
                        GetView()->BegUndo(
                            SdResId(STR_UNDO_REMOVE_SLIDE_SECTION_AND_SLIDES));

                    rMgr.RemoveSectionSlides(nSectionIdx);

                    if (bUndo)
                        GetView()->EndUndo();
                    GetDocSh()->SetModified();
                    ResetActualPage();
                }
            }
        }
        break;

        case SID_RENAME_SLIDE_SECTION:
        {
            sd::SlideSectionManager& rMgr = GetDoc()->GetSectionManager();
            if (rReq.GetArgs())
            {
                const SfxInt32Item* pIndexItem
                    = rReq.GetArgs()->GetItem<SfxInt32Item>(SID_RENAME_SLIDE_SECTION, false);
                const SfxStringItem* pNameItem
                    = rReq.GetArgs()->GetItem<SfxStringItem>(SID_RENAMEPAGE, false);
                if (pIndexItem && pNameItem)
                {
                    sal_Int32 nSectionIndex = pIndexItem->GetValue();
                    OUString aNewName = pNameItem->GetValue();
                    if (nSectionIndex >= 0 && nSectionIndex < rMgr.GetSectionCount()
                        && !aNewName.isEmpty())
                    {
                        auto pUndo = GetDoc()->IsUndoEnabled()
                            ? std::make_unique<sd::UndoSlideSection>(
                                  *GetDoc(), SdResId(STR_UNDO_RENAME_SLIDE_SECTION))
                            : nullptr;
                        rMgr.RenameSection(nSectionIndex, aNewName);
                        if (pUndo)
                            GetDoc()->AddUndo(std::move(pUndo));
                        GetDocSh()->SetModified();
                    }
                }
            }
        }
        break;

        case SID_MOVE_SLIDE_SECTION_UP:
        {
            SdPage* pPage = GetActualPage();
            if (pPage)
            {
                sal_uInt16 nPage = (pPage->GetPageNum() - 1) / 2;
                sd::SlideSectionManager& rMgr = GetDoc()->GetSectionManager();
                sal_Int32 nSectionIdx = rMgr.GetSectionIndexForSlide(nPage);
                if (nSectionIdx > 0)
                {
                    // Group the section metadata undo with the page-reorder undo
                    // recorded by MovePages() inside MoveSection().
                    const bool bUndo = GetDoc()->IsUndoEnabled();
                    if (bUndo)
                        GetDoc()->BegUndo(SdResId(STR_UNDO_MOVE_SLIDE_SECTION));
                    auto pUndo = bUndo
                        ? std::make_unique<sd::UndoSlideSection>(
                              *GetDoc(), SdResId(STR_UNDO_MOVE_SLIDE_SECTION))
                        : nullptr;
                    rMgr.MoveSection(nSectionIdx, nSectionIdx - 1);
                    if (bUndo)
                    {
                        GetDoc()->AddUndo(std::move(pUndo));
                        GetDoc()->EndUndo();
                    }
                    GetDocSh()->SetModified();
                }
            }
        }
        break;

        case SID_MOVE_SLIDE_SECTION_DOWN:
        {
            SdPage* pPage = GetActualPage();
            if (pPage)
            {
                sal_uInt16 nPage = (pPage->GetPageNum() - 1) / 2;
                sd::SlideSectionManager& rMgr = GetDoc()->GetSectionManager();
                sal_Int32 nSectionIdx = rMgr.GetSectionIndexForSlide(nPage);
                if (nSectionIdx >= 0 && nSectionIdx < rMgr.GetSectionCount() - 1)
                {
                    const bool bUndo = GetDoc()->IsUndoEnabled();
                    if (bUndo)
                        GetDoc()->BegUndo(SdResId(STR_UNDO_MOVE_SLIDE_SECTION));
                    auto pUndo = bUndo
                        ? std::make_unique<sd::UndoSlideSection>(
                              *GetDoc(), SdResId(STR_UNDO_MOVE_SLIDE_SECTION))
                        : nullptr;
                    rMgr.MoveSection(nSectionIdx, nSectionIdx + 1);
                    if (bUndo)
                    {
                        GetDoc()->AddUndo(std::move(pUndo));
                        GetDoc()->EndUndo();
                    }
                    GetDocSh()->SetModified();
                }
            }
        }
        break;

        case SID_PAGESIZE :  // either this (no menu entries or something else!)
        {
            const SfxItemSet *pArgs = rReq.GetArgs ();

            if (pArgs && pArgs->Count () == 3)
            {
                const SfxUInt32Item* pWidth = rReq.GetArg<SfxUInt32Item>(ID_VAL_PAGEWIDTH);
                const SfxUInt32Item* pHeight = rReq.GetArg<SfxUInt32Item>(ID_VAL_PAGEHEIGHT);
                const SfxBoolItem* pScaleAll = rReq.GetArg<SfxBoolItem>(ID_VAL_SCALEOBJECTS);

                Size aSize (pWidth->GetValue (), pHeight->GetValue ());

                SetupPage (aSize, 0, 0, 0, 0, true, false, pScaleAll->GetValue ());
                rReq.Ignore ();
                break;
            }
#if HAVE_FEATURE_SCRIPTING
            StarBASIC::FatalError (ERRCODE_BASIC_WRONG_ARGS);
#endif
            rReq.Ignore ();
            break;
        }

        case SID_PAGEMARGIN :  // or this (no menu entries or something else!)
        {
            const SfxItemSet *pArgs = rReq.GetArgs ();

            if (pArgs && pArgs->Count () == 5)
            {
                const SfxUInt32Item* pLeft = rReq.GetArg<SfxUInt32Item>(ID_VAL_PAGELEFT);
                const SfxUInt32Item* pRight = rReq.GetArg<SfxUInt32Item>(ID_VAL_PAGERIGHT);
                const SfxUInt32Item* pUpper = rReq.GetArg<SfxUInt32Item>(ID_VAL_PAGETOP);
                const SfxUInt32Item* pLower = rReq.GetArg<SfxUInt32Item>(ID_VAL_PAGEBOTTOM);
                const SfxBoolItem* pScaleAll = rReq.GetArg<SfxBoolItem>(ID_VAL_SCALEOBJECTS);

                Size aEmptySize (0, 0);

                SetupPage (aEmptySize, pLeft->GetValue (), pRight->GetValue (),
                           pUpper->GetValue (), pLower->GetValue (),
                           false, true, pScaleAll->GetValue ());
                rReq.Ignore ();
                break;
            }
#if HAVE_FEATURE_SCRIPTING
            StarBASIC::FatalError (ERRCODE_BASIC_WRONG_ARGS);
#endif
            rReq.Ignore ();
            break;
        }

        case SID_ATTR_ZOOMSLIDER:
        {
            const SfxItemSet* pArgs = rReq.GetArgs();

            const SfxUInt16Item* pScale = (pArgs && pArgs->Count () == 1) ?
                rReq.GetArg(SID_ATTR_ZOOMSLIDER) : nullptr;
            if (pScale && CHECK_RANGE (5, pScale->GetValue (), 3000))
            {
                SetZoom (pScale->GetValue ());

                SfxBindings& rBindings = GetViewFrame()->GetBindings();
                rBindings.Invalidate( SID_ATTR_ZOOM );
                rBindings.Invalidate( SID_ZOOM_IN );
                rBindings.Invalidate( SID_ZOOM_OUT );
                rBindings.Invalidate( SID_ATTR_ZOOMSLIDER );

            }

            Cancel();
            rReq.Done ();
            break;
        }

        case SID_ATTR_ZOOM:
        {
            const SfxItemSet* pArgs = rReq.GetArgs();
            mbZoomOnPage = false;

            if ( pArgs )
            {
                SvxZoomType eZT = pArgs->Get( SID_ATTR_ZOOM ).GetType();
                switch( eZT )
                {
                    case SvxZoomType::PERCENT:
                    {
                        sal_uInt16 nZoom = pArgs->Get( SID_ATTR_ZOOM ).GetValue();
                        SetZoom( static_cast<::tools::Long>( nZoom ) );
                    }
                        break;

                    case SvxZoomType::OPTIMAL:
                        GetViewFrame()->GetDispatcher()->Execute( SID_SIZE_ALL,
                                    SfxCallMode::ASYNCHRON | SfxCallMode::RECORD );
                        break;

                    case SvxZoomType::PAGEWIDTH:
                        GetViewFrame()->GetDispatcher()->Execute( SID_SIZE_PAGE_WIDTH,
                                    SfxCallMode::ASYNCHRON | SfxCallMode::RECORD );
                        break;

                    case SvxZoomType::WHOLEPAGE:
                        GetViewFrame()->GetDispatcher()->Execute( SID_SIZE_PAGE,
                                    SfxCallMode::ASYNCHRON | SfxCallMode::RECORD );
                        break;
                    case SvxZoomType::PAGEWIDTH_NOBORDER:
                        OSL_FAIL("sd::DrawViewShell::FuTemporary(), SvxZoomType::PAGEWIDTH_NOBORDER not handled!" );
                        break;
                }
                rReq.Ignore ();
            }
            else
            {
                // open zoom dialog
                SetCurrentFunction( FuScale::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            }
            Cancel();
        }
        break;

        case SID_CHANGEBEZIER:
        case SID_CHANGEPOLYGON:
            if ( mpDrawView->IsTextEdit() )
            {
                mpDrawView->SdrEndTextEdit();
                GetViewFrame()->GetDispatcher()->Execute(SID_OBJECT_SELECT, SfxCallMode::ASYNCHRON);
            }

            if ( mpDrawView->IsPresObjSelected() )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                if( rReq.GetSlot() == SID_CHANGEBEZIER )
                {
                    weld::WaitObject aWait(GetFrameWeld());
                    mpDrawView->ConvertMarkedToPathObj(false);
                }
                else
                {
                    if( mpDrawView->IsVectorizeAllowed() )
                    {
                        SetCurrentFunction( FuVectorize::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
                    }
                    else
                    {
                        weld::WaitObject aWait(GetFrameWeld());
                        mpDrawView->ConvertMarkedToPolyObj();
                    }
                }

                Invalidate(SID_CHANGEBEZIER);
                Invalidate(SID_CHANGEPOLYGON);
            }
            Cancel();

            if( HasCurrentFunction(SID_BEZIER_EDIT) )
            {   // where applicable, activate right edit action
                GetViewFrame()->GetDispatcher()->Execute(SID_SWITCH_POINTEDIT,
                                        SfxCallMode::ASYNCHRON | SfxCallMode::RECORD);
            }
            rReq.Ignore ();
            break;

        case SID_CONVERT_TO_CONTOUR:
            if ( mpDrawView->IsTextEdit() )
            {
                mpDrawView->SdrEndTextEdit();
                GetViewFrame()->GetDispatcher()->Execute(SID_OBJECT_SELECT, SfxCallMode::ASYNCHRON);
            }

            if ( mpDrawView->IsPresObjSelected() )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                weld::WaitObject aWait(GetFrameWeld());
                mpDrawView->ConvertMarkedToPathObj(true);

                Invalidate(SID_CONVERT_TO_CONTOUR);
            }
            Cancel();

            rReq.Ignore ();
            break;

        case SID_CONVERT_TO_METAFILE:
        case SID_CONVERT_TO_BITMAP:
        {
            // End text edit mode when it is active because the metafile or
            // bitmap that will be created does not support it.
            if ( mpDrawView->IsTextEdit() )
            {
                mpDrawView->SdrEndTextEdit();
                GetViewFrame()->GetDispatcher()->Execute(SID_OBJECT_SELECT, SfxCallMode::ASYNCHRON);
            }

            if ( mpDrawView->IsPresObjSelected(true,true,true) )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                weld::WaitObject aWait(GetFrameWeld());

                // create SdrGrafObj from metafile/bitmap
                Graphic aGraphic;
                switch (nSId)
                {
                    case SID_CONVERT_TO_METAFILE:
                    {
                        // switch on undo for the next operations
                        mpDrawView->BegUndo(SdResId(STR_UNDO_CONVERT_TO_METAFILE));
                        GDIMetaFile aMetaFile(mpDrawView->GetMarkedObjMetaFile());
                        aGraphic = Graphic(aMetaFile);
                    }
                    break;
                    case SID_CONVERT_TO_BITMAP:
                    {
                        // Disable spelling during conversion
                        bool bOnlineSpell = GetDoc()->GetOnlineSpell();
                        GetDoc()->SetOnlineSpell(false);

                        // switch on undo for the next operations
                        mpDrawView->BegUndo(SdResId(STR_UNDO_CONVERT_TO_BITMAP));
                        aGraphic = Graphic(mpDrawView->GetMarkedObjBitmap());
                        // Restore online spelling
                        GetDoc()->SetOnlineSpell(bOnlineSpell);
                    }
                    break;
                }

                // create new object
                rtl::Reference<SdrGrafObj> pGraphicObj = new SdrGrafObj(
                    *GetDoc(),
                    aGraphic);

                // get some necessary info and ensure it
                const size_t nMarkCount(rMarkList.GetMarkCount());
                SdrPageView* pPageView = mpDrawView->GetSdrPageView();
                OSL_ENSURE(nMarkCount, "DrawViewShell::FuTemporary: SID_CONVERT_TO_BITMAP with empty selection (!)");
                OSL_ENSURE(pPageView, "DrawViewShell::FuTemporary: SID_CONVERT_TO_BITMAP without SdrPageView (!)");

                // fit rectangle of new graphic object to selection's mark rect
                ::tools::Rectangle aAllMarkedRect;
                rMarkList.TakeBoundRect(pPageView, aAllMarkedRect);
                pGraphicObj->SetLogicRect(aAllMarkedRect);

                // #i71540# to keep the order, it is necessary to replace the lowest object
                // of the selection with the new object. This also means that with multi
                // selection, all other objects need to be deleted first
                SdrMark* pFirstMark = rMarkList.GetMark(0);
                SdrObject* pReplacementCandidate = pFirstMark->GetMarkedSdrObj();

                if(nMarkCount > 1)
                {
                    // take first object out of selection
                    mpDrawView->MarkObj(pReplacementCandidate, pPageView, true, true);

                    // clear remaining selection
                    mpDrawView->DeleteMarkedObj();
                }

                // #i124816# copy layer from lowest object which gets replaced
                pGraphicObj->SetLayer(pReplacementCandidate->GetLayer());

                // now replace lowest object with new one
                mpDrawView->ReplaceObjectAtView(pReplacementCandidate, *pPageView, pGraphicObj.get());

                // switch off undo
                mpDrawView->EndUndo();
            }
        }

        Cancel();

        rReq.Done ();
        break;

        case SID_REMOVE_HYPERLINK:
        {
            if (mpDrawView->IsTextEdit())
            {
                OutlinerView* pOutView = mpDrawView->GetTextEditOutlinerView();
                if (pOutView)
                    URLFieldHelper::RemoveURLField(pOutView->GetEditView());
            }
        }
        Cancel();
        rReq.Done ();
        break;

        case SID_SET_DEFAULT:
        {
            std::optional<SfxItemSet> pSet;

            if (mpDrawView->IsTextEdit())
            {
                pSet.emplace( GetPool(), svl::Items<EE_ITEMS_START, EE_ITEMS_END> );
                mpDrawView->SetAttributes( *pSet, true );
            }
            else
            {
                const size_t nCount = rMarkList.GetMarkCount();

                // For every presentation object a SfxItemSet of hard attributes
                // and the UserCall is stored in this list. This is because
                // at the following mpDrawView->SetAttributes( *pSet, true )
                // they get lost and have to be restored.
                std::vector<std::pair<std::unique_ptr<SfxItemSet>,SdrObjUserCall*> > aAttrList;
                SdPage* pPresPage = static_cast<SdPage*>( mpDrawView->GetSdrPageView()->GetPage() );

                for ( size_t i = 0; i < nCount; ++i )
                {
                    SdrObject* pObj = rMarkList.GetMark(i)->GetMarkedSdrObj();

                    if( pPresPage->IsPresObj( pObj ) )
                    {
                        auto pNewSet = std::make_unique<SfxItemSetFixed<SDRATTR_TEXT_MINFRAMEHEIGHT, SDRATTR_TEXT_AUTOGROWHEIGHT>>( GetDoc()->GetPool() );
                        pNewSet->Put(pObj->GetMergedItemSet());
                        aAttrList.emplace_back(std::move(pNewSet), pObj->GetUserCall());
                    }
                }

                pSet.emplace( GetPool() );
                mpDrawView->SetAttributes( *pSet, true );

                sal_uLong j = 0;

                for ( size_t i = 0; i < nCount; ++i )
                {
                    SfxStyleSheet* pSheet = nullptr;
                    SdrObject* pObj = rMarkList.GetMark(i)->GetMarkedSdrObj();

                    if (pObj->GetObjIdentifier() == SdrObjKind::TitleText)
                    {
                        pSheet = mpActualPage->GetStyleSheetForPresObj(PresObjKind::Title);
                        if (pSheet)
                            pObj->SetStyleSheet(pSheet, false);
                    }
                    else if(pObj->GetObjIdentifier() == SdrObjKind::OutlineText)
                    {
                        for (sal_uInt16 nLevel = 1; nLevel < 10; nLevel++)
                        {
                            pSheet = mpActualPage->GetStyleSheetForPresObj( PresObjKind::Outline );
                            DBG_ASSERT(pSheet, "Template for outline object not found");
                            if (pSheet)
                            {
                                pObj->StartListening(*pSheet);

                                if( nLevel == 1 )
                                    // text frame listens on StyleSheet of level1
                                    pObj->NbcSetStyleSheet(pSheet, false);
                            }
                        }
                    }

                    if( pPresPage->IsPresObj( pObj ) )
                    {
                        std::pair<std::unique_ptr<SfxItemSet>,SdrObjUserCall*> &rAttr = aAttrList[j++];

                        std::unique_ptr<SfxItemSet> & pNewSet(rAttr.first);
                        SdrObjUserCall* pUserCall = rAttr.second;

                        if ( pNewSet && pNewSet->GetItemState( SDRATTR_TEXT_MINFRAMEHEIGHT ) == SfxItemState::SET )
                        {
                            pObj->SetMergedItem(pNewSet->Get(SDRATTR_TEXT_MINFRAMEHEIGHT));
                        }

                        if ( pNewSet && pNewSet->GetItemState( SDRATTR_TEXT_AUTOGROWHEIGHT ) == SfxItemState::SET )
                        {
                            pObj->SetMergedItem(pNewSet->Get(SDRATTR_TEXT_AUTOGROWHEIGHT));
                        }

                        if( pUserCall )
                            pObj->SetUserCall( pUserCall );
                    }
                }
            }

            pSet.reset();
            Cancel();
        }
        break;

        case SID_DELETE_SNAPITEM:
        {
            SdrPageView* pPV;
            Point   aMPos = GetActiveWindow()->PixelToLogic( maMousePos );
            sal_uInt16  nHitLog = static_cast<sal_uInt16>(GetActiveWindow()->PixelToLogic( Size(
                FuPoor::HITPIX, 0 ) ).Width());
            sal_uInt16  nHelpLine;

            if( mpDrawView->PickHelpLine( aMPos, nHitLog, *GetActiveWindow()->GetOutDev(), nHelpLine, pPV) )
            {
                pPV->DeleteHelpLine( nHelpLine );
            }
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_DELETE_PAGE:
        case SID_DELETE_MASTER_PAGE:
            DeleteActualPage();
            Cancel();
            rReq.Ignore ();
        break;

        case SID_DELETE_LAYER:
            DeleteActualLayer();
            Cancel();
            rReq.Ignore ();
        break;

        case SID_ORIGINAL_SIZE:
            mpDrawView->SetMarkedOriginalSize();
            Cancel();
            rReq.Done();
        break;

        case SID_DRAW_FONTWORK:
        case SID_DRAW_FONTWORK_VERTICAL:
        {
            svx::FontworkBar::execute(*mpView, rReq, GetViewFrame()->GetBindings());       // SJ: can be removed  (I think)
            Cancel();
            rReq.Done();
        }
        break;

        case SID_SAVE_GRAPHIC:
        {
            if( rMarkList.GetMarkCount() == 1 )
            {
                if (const SdrGrafObj* pObj = dynamic_cast<const SdrGrafObj*>(rMarkList.GetMark(0)->GetMarkedSdrObj()))
                    if (pObj->GetGraphicType() == GraphicType::Bitmap || pObj->GetGraphicType() == GraphicType::GdiMetafile)
                    {
                        if (comphelper::COKit::isActive())
                        {
                            const GraphicObject& aGraphicObject(pObj->GetGraphicObject());
                            OUString sTempFileURL = GraphicHelper::ExportGraphicToTempFile(
                                aGraphicObject.GetGraphic(), u"");
                            if (!sTempFileURL.isEmpty())
                            {
                                SfxViewShell* pViewShell = SfxViewShell::Current();
                                if (pViewShell)
                                    pViewShell->viewCallback(
                                        KIT_CALLBACK_EXPORT_FILE, sTempFileURL.toUtf8());
                            }
                        }
                        else
                        {
                            weld::Window* pFrame = GetFrameWeld();
                            GraphicAttr aGraphicAttr = pObj->GetGraphicAttr();
                            short nState = RET_CANCEL;
                            if (aGraphicAttr != GraphicAttr()) // the image has been modified
                            {
                                if (pFrame)
                                {
                                    nState = GraphicHelper::HasToSaveTransformedImage(pFrame);
                                }
                            }
                            else
                            {
                                nState = RET_NO;
                            }

                            if (nState == RET_YES)
                            {
                                GraphicHelper::ExportGraphic(pFrame, pObj->GetTransformedGraphic(), u""_ustr);
                            }
                            else if (nState == RET_NO)
                            {
                                const GraphicObject& aGraphicObject(pObj->GetGraphicObject());
                                GraphicHelper::ExportGraphic(pFrame, aGraphicObject.GetGraphic(), u""_ustr);
                            }
                        }
                    }
            }
            Cancel();
            rReq.Ignore();
        }
        break;

        case SID_EXTERNAL_EDIT:
        {
            if( rMarkList.GetMarkCount() == 1 )
            {
                SdrObject* pObj = rMarkList.GetMark( 0 )->GetMarkedSdrObj();
                if( auto pGraphicObj = dynamic_cast<SdrGrafObj*>( pObj ) )
                    if( pGraphicObj->GetGraphicType() == GraphicType::Bitmap )
                    {
                        GraphicObject aGraphicObject( pGraphicObj->GetGraphicObject() );
                        m_ExternalEdits.push_back(
                            std::make_unique<SdrExternalToolEdit>(
                                mpDrawView.get(), pGraphicObj));
                        m_ExternalEdits.back()->Edit( &aGraphicObject );
                    }
            }
            Cancel();
            rReq.Ignore();
        }
        break;

        case SID_COMPRESS_GRAPHIC:
        {
            if( rMarkList.GetMarkCount() == 1 )
            {
                rtl::Reference<SdrObject> xObj = rMarkList.GetMark( 0 )->GetMarkedSdrObj();

                if( auto pGraphicObj = dynamic_cast<SdrGrafObj*>(xObj.get()) )
                {
                    if( pGraphicObj->GetGraphicType() == GraphicType::Bitmap )
                    {
                        auto xDialog = std::make_shared<CompressGraphicsDialog>(GetFrameWeld(), pGraphicObj, GetViewFrame()->GetBindings());
                        OUString aUndoString = rMarkList.GetMarkDescription() + " Compress";
                        ::sd::View* pView = mpDrawView.get();
                        weld::DialogController::runAsync(xDialog, [pView, xObj, xDialog, aUndoString](sal_uInt32 nResult) {
                            if (nResult == RET_OK)
                            {
                                rtl::Reference<SdrGrafObj> pNewObject = xDialog->GetCompressedSdrGrafObj();
                                SdrPageView* pPageView = pView->GetSdrPageView();
                                pView->BegUndo( aUndoString );
                                pView->ReplaceObjectAtView( xObj.get(), *pPageView, pNewObject.get() );
                                pView->EndUndo();
                            }
                        });
                    }
                }
            }
            Cancel();
            rReq.Ignore();
        }
        break;

        case SID_GRAPHIC_SIZE_CHECK:
        {
            sd::GraphicSizeCheckGUIResult aResult(GetDoc());
            svx::GenericCheckDialog aDialog(GetFrameWeld(), aResult);
            aDialog.run();

            Cancel();
            rReq.Ignore();
        }
        break;

        case SID_ATTRIBUTES_LINE:  // BASIC
        {
            SetCurrentFunction( FuLine::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            if (rReq.GetArgs())
                Cancel();
        }
        break;

        case SID_ATTRIBUTES_AREA:  // BASIC
        {
            SetCurrentFunction( FuArea::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            if (rReq.GetArgs())
                Cancel();
        }
        break;

        case SID_ATTR_TRANSFORM:
        {
            SetCurrentFunction( FuTransform::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            // tdf#138963 conditions tested for here must be the same as those
            // of the early returns from FuTransform::DoExecute
            if (rReq.GetArgs() || rMarkList.GetMarkCount() == 0)
            {
                Invalidate(SID_RULER_OBJECT);
                Cancel();
            }
        }
        break;
        case SID_MOVE_SHAPE_HANDLE:
        {
            const SfxItemSet *pArgs = rReq.GetArgs ();
            if (pArgs && pArgs->Count () >= 3)
            {
                const SfxUInt32Item* handleNumItem = rReq.GetArg<SfxUInt32Item>(FN_PARAM_1);
                const SfxUInt32Item* newPosXTwips = rReq.GetArg<SfxUInt32Item>(FN_PARAM_2);
                const SfxUInt32Item* newPosYTwips = rReq.GetArg<SfxUInt32Item>(FN_PARAM_3);
                const SfxInt32Item* OrdNum = rReq.GetArg<SfxInt32Item>(FN_PARAM_4);
                const SfxBoolItem* pPreview = rReq.GetArg<SfxBoolItem>(FN_PARAM_5);

                const sal_uInt32 handleNum = handleNumItem->GetValue();
                const ::tools::Long newPosX = convertTwipToMm100(newPosXTwips->GetValue());
                const ::tools::Long newPosY = convertTwipToMm100(newPosYTwips->GetValue());

                mpDrawView->MoveShapeHandle(handleNum, Point(newPosX, newPosY), OrdNum ? OrdNum->GetValue() : -1,
                                            pPreview && pPreview->GetValue());
                Cancel();
            }
            break;
        }
        case SID_CHAR_DLG_EFFECT:
        case SID_CHAR_DLG:  // BASIC
        {
            SetCurrentFunction( FuChar::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
        }
        break;

        case SID_PARA_DLG:
        {
            SetCurrentFunction( FuParagraph::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
        }
        break;

        case FN_NUM_BULLET_ON:
        {
            SfxUInt16Item aItem(FN_SVX_SET_BULLET, FuBulletAndPosition::BULLET_TOGGLE);
            GetViewFrame()->GetDispatcher()->ExecuteList(FN_SVX_SET_BULLET,
                    SfxCallMode::RECORD, { &aItem });
        }
        break;

        case FN_NUM_NUMBERING_ON:
        {
            SfxUInt16Item aItem(FN_SVX_SET_NUMBER, FuBulletAndPosition::BULLET_TOGGLE);
            GetViewFrame()->GetDispatcher()->ExecuteList(FN_SVX_SET_NUMBER,
                    SfxCallMode::RECORD, { &aItem });
        }
        break;

        case SID_OUTLINE_BULLET:
        case FN_SVX_SET_BULLET:
        case FN_SVX_SET_NUMBER:
        {
            SetCurrentFunction( FuBulletAndPosition::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
            SfxBindings& rBindings = GetViewFrame()->GetBindings();
            rBindings.Invalidate( FN_NUM_BULLET_ON );
            rBindings.Invalidate( FN_NUM_NUMBERING_ON );
        }
        break;

        case FN_INSERT_SOFT_HYPHEN:
        case FN_INSERT_HARDHYPHEN:
        case FN_INSERT_HARD_SPACE:
        case FN_INSERT_NNBSP:
        case SID_INSERT_RLM :
        case SID_INSERT_LRM :
        case SID_INSERT_WJ :
        case SID_INSERT_ZWSP:
        case SID_CHARMAP:
        {
            SetCurrentFunction( FuBullet::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
        }
        break;

        case SID_PRESENTATION_LAYOUT:
        {
            SetCurrentFunction( FuPresentationLayout::Create(*this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq) );
            Cancel();
        }
        break;

        case SID_PASTE_SPECIAL:
        {
            SetCurrentFunction( FuInsertClipboard::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_CHANGE_PICTURE:
        case SID_INSERT_GRAPHIC:
        {
            SetCurrentFunction( FuInsertGraphic::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq,
                                                         nSId == SID_CHANGE_PICTURE ) );
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_INSERT_AVMEDIA:
        {
            SetCurrentFunction( FuInsertAVMedia::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );

            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_INSERT_OBJECT:
        case SID_INSERT_FLOATINGFRAME:
        case SID_INSERT_MATH:
        case SID_INSERT_DIAGRAM:
        case SID_ATTR_TABLE:
        {
            SetCurrentFunction( FuInsertOLE::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            // Set the selection tool as the old one. This in particular important for the
            // zoom function, in which clicking without dragging zooms as well, and that
            // makes exiting the object editing mode impossible.
            if (dynamic_cast<FuSelection*>( GetOldFunction().get() ) == nullptr)
                SetOldFunction( FuSelection::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
            rReq.Ignore ();
        }
        break;
        case SID_CLASSIFICATION_APPLY:
        {
            const SfxItemSet* pArgs = rReq.GetArgs();
            const SfxPoolItem* pItem = nullptr;
            if (pArgs && pArgs->GetItemState(nSId, false, &pItem) == SfxItemState::SET)
            {
                const OUString& rName = static_cast<const SfxStringItem*>(pItem)->GetValue();
                auto eType = SfxClassificationPolicyType::IntellectualProperty;
                if (pArgs->GetItemState(SID_TYPE_NAME, false, &pItem) == SfxItemState::SET)
                {
                    const OUString& rType = static_cast<const SfxStringItem*>(pItem)->GetValue();
                    eType = SfxClassificationHelper::stringToPolicyType(rType);
                }
                if (SfxViewFrame* pViewFrame = GetViewFrame())
                {
                    if (SfxObjectShell* pObjectShell = pViewFrame->GetObjectShell())
                    {
                        SfxClassificationHelper aHelper(pObjectShell->getDocProperties());
                        aHelper.SetBACName(rName, eType);
                    }
                }
            }
            else
                SAL_WARN("sd.ui", "missing parameter for SID_CLASSIFICATION_APPLY");

            Cancel();
            rReq.Ignore();
        }
        break;

        case SID_CLASSIFICATION_DIALOG:
        {
            if (SfxObjectShell* pObjShell = SfxObjectShell::Current())
            {
                css::uno::Reference<css::document::XDocumentProperties> xDocProps(pObjShell->getDocProperties());
                auto xDialog = std::make_shared<svx::ClassificationDialog>(GetFrameWeld(), xDocProps, false, [](){} );
                ClassificationCollector aCollector(*this, xDocProps);
                aCollector.collect();

                xDialog->setupValues(std::vector(aCollector.getResults()));

                if (RET_OK == xDialog->run())
                {
                    ClassificationInserter aInserter(*this, xDocProps);
                    aInserter.insert(xDialog->getResult());
                }
                xDialog.reset();
            }

            Cancel();
            rReq.Ignore();
        }
        break;

        case SID_COPYOBJECTS:
        {
            if ( mpDrawView->IsPresObjSelected(false) )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                if ( mpDrawView->IsTextEdit() )
                {
                    mpDrawView->SdrEndTextEdit();
                }

                SetCurrentFunction( FuCopy::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            }
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_INSERTFILE:  // BASIC
        {
            Broadcast (ViewShellHint(ViewShellHint::HINT_COMPLEX_MODEL_CHANGE_START));
            SetCurrentFunction( FuInsertFile::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Broadcast (ViewShellHint(ViewShellHint::HINT_COMPLEX_MODEL_CHANGE_END));
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_SELECT_BACKGROUND:
        case SID_SAVE_BACKGROUND:
        case SID_ATTR_PAGE_SIZE:
        case SID_ATTR_PAGE:
        case SID_PAGESETUP:  // BASIC ??
        {
            SetCurrentFunction( FuPage::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
            rReq.Ignore (); // we generate independent macros !!
        }
        break;

        case SID_BEFORE_OBJ:
        case SID_BEHIND_OBJ:
        {
            SetCurrentFunction( FuDisplayOrder::Create(*this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq) );
            rReq.Done();
            // finishes itself, no Cancel() needed!
        }
        break;

        case SID_REVERSE_ORDER:   // BASIC
        {
            mpDrawView->ReverseOrderOfMarked();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_ANIMATION_EFFECTS:
        {
            SetCurrentFunction( FuObjectAnimationParameters::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq) );
            Cancel();
        }
        break;

        case SID_EXECUTE_ANIMATION_EFFECT:
        {
            SetCurrentFunction(FuExecuteInteraction::Create(*this, GetActiveWindow(),
                                                            mpDrawView.get(), *GetDoc(), rReq));
            Cancel();
        }
        break;

        case SID_LINEEND_POLYGON:
        {
            SetCurrentFunction( FuLineEnd::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
        }
        break;

        case SID_CAPTUREPOINT:
            // negative value to signal call from menu
            maMousePos = Point(-1,-1);
            [[fallthrough]];
        case SID_SET_SNAPITEM:
        {
            SetCurrentFunction( FuSnapLine::Create(*this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq) );
            Cancel();
        }
        break;

        case SID_MANAGE_LINKS:
        {
            SetCurrentFunction( FuLink::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_THESAURUS:
        {
            SetCurrentFunction( FuThesaurus::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_TEXTATTR_DLG:
        {
            if (mpDrawView->IsTextEdit())
                mpDrawView->SdrEndTextEdit();
            SetCurrentFunction( FuTextAttrDlg::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_MEASURE_DLG:
        {
            SetCurrentFunction( FuMeasureDlg::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_CONNECTION_DLG:
        {
            SetCurrentFunction( FuConnectionDlg::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
            rReq.Done();
        }
        break;

        case SID_CONNECTION_NEW_ROUTING:
        {
            SfxItemSetFixed<SDRATTR_EDGELINE1DELTA, SDRATTR_EDGELINE3DELTA> aDefAttr( GetPool() );
            GetView()->SetAttributes( aDefAttr, true ); // (ReplaceAll)

            Cancel();
            rReq.Done();
        }
        break;

        case SID_TWAIN_SELECT:
        {
            if( mxScannerManager.is() )
            {
                try
                {
                    const cpo::uno::Sequence< css::scanner::ScannerContext >
                        aContexts( mxScannerManager->getAvailableScanners() );

                    if( aContexts.hasElements() )
                    {
                        css::scanner::ScannerContext aContext( aContexts.getConstArray()[ 0 ] );

                        Reference<lang::XInitialization> xInit(mxScannerManager, UNO_QUERY);
                        if (xInit.is())
                        {
                            //  initialize dialog
                            weld::Window* pWindow = rReq.GetFrameWeld();
                            cpo::uno::Sequence<cpo::uno::Any> aSeq(comphelper::InitAnyPropertySequence(
                            {
                                {"ParentWindow", pWindow ? cpo::uno::Any(pWindow->GetXWindow()) : cpo::uno::Any(Reference<awt::XWindow>())}
                            }));
                            xInit->initialize( aSeq );
                        }

                        mxScannerManager->configureScannerAndScan( aContext, mxScannerListener );
                    }
                }
                catch(...)
                {
                }
            }

            Cancel();
            rReq.Done();
        }
        break;

        case SID_TWAIN_TRANSFER:
        {
            bool bDone = false;

            if( mxScannerManager.is() )
            {
                try
                {
                    const cpo::uno::Sequence< css::scanner::ScannerContext > aContexts( mxScannerManager->getAvailableScanners() );

                    if( aContexts.hasElements() )
                    {
                        mxScannerManager->startScan( aContexts.getConstArray()[ 0 ], mxScannerListener );
                        bDone = true;
                    }
                }
                catch( ... )
                {
                }
            }

            if( !bDone )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
#ifndef UNX
                                                              SdResId(STR_TWAIN_NO_SOURCE)
#else
                                                              SdResId(STR_TWAIN_NO_SOURCE_UNX)
#endif
                                                              ));
                xInfoBox->run();

            }
            else
            {
                SfxBindings& rBindings = GetViewFrame()->GetBindings();
                rBindings.Invalidate( SID_TWAIN_SELECT );
                rBindings.Invalidate( SID_TWAIN_TRANSFER );
            }

            Cancel();
            rReq.Done();
        }
        break;

        case SID_POLYGON_MORPHING:
        {
            SetCurrentFunction( FuMorph::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
        }
        break;

        case SID_INSERTLAYER:
        {
            if ( mpDrawView->IsTextEdit() )
            {
                mpDrawView->SdrEndTextEdit();
            }

            SdrLayerAdmin& rLayerAdmin = GetDoc()->GetLayerAdmin();
            sal_uInt16 nLayerCnt = rLayerAdmin.GetLayerCount();
            sal_uInt16 nLayer = nLayerCnt - 2 + 1;
            OUString aLayerName = SdResId(STR_LAYER) + OUString::number(nLayer);
            OUString aLayerTitle, aLayerDesc;
            bool bIsVisible = false;
            bool bIsLocked = false;
            bool bIsPrintable = false;

            const SfxItemSet* pArgs = rReq.GetArgs();

            if (! pArgs)
            {
                SfxItemSetFixed<ATTR_LAYER_START, ATTR_LAYER_END> aNewAttr( GetDoc()->GetPool() );

                aNewAttr.Put( makeSdAttrLayerName( aLayerName ) );
                aNewAttr.Put( makeSdAttrLayerTitle() );
                aNewAttr.Put( makeSdAttrLayerDesc() );
                aNewAttr.Put( makeSdAttrLayerVisible() );
                aNewAttr.Put( makeSdAttrLayerPrintable() );
                aNewAttr.Put( makeSdAttrLayerLocked() );
                aNewAttr.Put( makeSdAttrLayerThisPage() );

                SdAbstractDialogFactory* pFact = SdAbstractDialogFactory::Create();
                vcl::Window* pWin = GetActiveWindow();
                ScopedVclPtr<AbstractSdInsertLayerDlg> pDlg( pFact->CreateSdInsertLayerDlg(pWin ? pWin->GetFrameWeld() : nullptr, aNewAttr, true, SdResId(STR_INSERTLAYER)) );
                pDlg->SetHelpId( SdModule::get()->GetSlotPool()->GetSlot( SID_INSERTLAYER )->GetCommand() );

                // test for already existing names
                bool bLoop = true;
                while( bLoop && pDlg->Execute() == RET_OK )
                {
                    pDlg->GetAttr( aNewAttr );
                    aLayerName   = aNewAttr.Get(ATTR_LAYER_NAME).GetValue ();

                    if( rLayerAdmin.GetLayer( aLayerName )
                        || aLayerName.isEmpty()
                        || LayerTabBar::IsLocalizedNameOfStandardLayer( aLayerName) )
                    {
                        // name already exists
                        std::unique_ptr<weld::MessageDialog> xWarn(Application::CreateMessageDialog(GetFrameWeld(),
                                                                   VclMessageType::Warning, VclButtonsType::Ok,
                                                                   SdResId(STR_WARN_NAME_DUPLICATE)));
                        xWarn->run();
                    }
                    else
                        bLoop = false;
                }
                if( bLoop ) // was canceled
                {
                    pDlg.disposeAndClear();
                    Cancel();
                    rReq.Ignore ();
                    break;
                }
                else
                {
                    aLayerTitle  = aNewAttr.Get(ATTR_LAYER_TITLE).GetValue();
                    aLayerDesc   = aNewAttr.Get(ATTR_LAYER_DESC).GetValue ();
                    bIsVisible   = static_cast<const SfxBoolItem &>( aNewAttr.Get (ATTR_LAYER_VISIBLE)).GetValue ();
                    bIsLocked    = static_cast<const SfxBoolItem &>( aNewAttr.Get (ATTR_LAYER_LOCKED)).GetValue () ;
                    bIsPrintable = static_cast<const SfxBoolItem &>( aNewAttr.Get (ATTR_LAYER_PRINTABLE)).GetValue () ;
                }
            }
            else if (pArgs->Count () != 4)
            {
#if HAVE_FEATURE_SCRIPTING
                 StarBASIC::FatalError (ERRCODE_BASIC_WRONG_ARGS);
#endif
                 Cancel();
                 rReq.Ignore ();
                 break;
            }
            else
            {
                 const SfxStringItem* pLayerName = rReq.GetArg<SfxStringItem>(ID_VAL_LAYERNAME);
                 const SfxBoolItem* pIsVisible = rReq.GetArg<SfxBoolItem>(ID_VAL_ISVISIBLE);
                 const SfxBoolItem* pIsLocked = rReq.GetArg<SfxBoolItem>(ID_VAL_ISLOCKED);
                 const SfxBoolItem* pIsPrintable = rReq.GetArg<SfxBoolItem>(ID_VAL_ISPRINTABLE);

                 aLayerName   = pLayerName->GetValue ();
                 bIsVisible   = pIsVisible->GetValue ();
                 bIsLocked    = pIsLocked->GetValue ();
                 bIsPrintable = pIsPrintable->GetValue ();
            }

            OUString aPrevLayer = mpDrawView->GetActiveLayer();
            SdrLayer* pLayer;
            sal_uInt16 nPrevLayer = 0;
            nLayerCnt = rLayerAdmin.GetLayerCount();

            for ( nLayer = 0; nLayer < nLayerCnt; nLayer++ )
            {
                pLayer = rLayerAdmin.GetLayer(nLayer);
                OUString aName = pLayer->GetName();

                if ( aPrevLayer == aName )
                {
                    nPrevLayer = std::max(nLayer, sal_uInt16(4));
                }
            }

            mpDrawView->InsertNewLayer(aLayerName, nPrevLayer + 1);
            pLayer = rLayerAdmin.GetLayer(aLayerName);
            if( pLayer )
            {
                pLayer->SetTitle( aLayerTitle );
                pLayer->SetDescription( aLayerDesc );
            }

            mpDrawView->SetLayerVisible( aLayerName, bIsVisible );
            mpDrawView->SetLayerLocked( aLayerName, bIsLocked);
            mpDrawView->SetLayerPrintable(aLayerName, bIsPrintable);

            mpDrawView->SetActiveLayer(aLayerName);

            ResetActualLayer();

            GetDoc()->SetChanged();

            GetViewFrame()->GetDispatcher()->Execute(SID_SWITCHLAYER,
                    SfxCallMode::ASYNCHRON | SfxCallMode::RECORD);

            Cancel();
            rReq.Done ();
        }
        break;

        case SID_MODIFYLAYER:
        {
            if(!GetLayerTabControl()) // #i87182#
            {
                OSL_ENSURE(false, "No LayerTabBar (!)");
                Cancel();
                rReq.Ignore();
                break;
            }

            if ( mpDrawView->IsTextEdit() )
            {
                mpDrawView->SdrEndTextEdit();
            }

            SdrLayerAdmin& rLayerAdmin = GetDoc()->GetLayerAdmin();
            sal_uInt16 nCurPage = GetLayerTabControl()->GetCurPageId();
            OUString aLayerName = GetLayerTabControl()->GetLayerName(nCurPage);
            SdrLayer* pLayer = rLayerAdmin.GetLayer(aLayerName);

            OUString aLayerTitle = pLayer->GetTitle();
            OUString aLayerDesc = pLayer->GetDescription();

            OUString aOldLayerName(aLayerName);
            OUString aOldLayerTitle(aLayerTitle);
            OUString aOldLayerDesc(aLayerDesc);

            bool bIsVisible, bIsLocked, bIsPrintable;
            bool bOldIsVisible = bIsVisible = mpDrawView->IsLayerVisible(aLayerName);
            bool bOldIsLocked = bIsLocked = mpDrawView->IsLayerLocked(aLayerName);
            bool bOldIsPrintable = bIsPrintable = mpDrawView->IsLayerPrintable(aLayerName);

            const SfxItemSet* pArgs = rReq.GetArgs();
            // is it allowed to delete the layer?
            bool bDelete = !( LayerTabBar::IsRealNameOfStandardLayer(aLayerName) );

            if (! pArgs)
            {
                SfxItemSetFixed<ATTR_LAYER_START, ATTR_LAYER_END> aNewAttr( GetDoc()->GetPool() );

                aNewAttr.Put( makeSdAttrLayerName( aLayerName ) );
                aNewAttr.Put( makeSdAttrLayerTitle( aLayerTitle ) );
                aNewAttr.Put( makeSdAttrLayerDesc( aLayerDesc ) );
                aNewAttr.Put( makeSdAttrLayerVisible( bIsVisible ) );
                aNewAttr.Put( makeSdAttrLayerLocked( bIsLocked ) );
                aNewAttr.Put( makeSdAttrLayerPrintable( bIsPrintable ) );
                aNewAttr.Put( makeSdAttrLayerThisPage() );

                SdAbstractDialogFactory* pFact = SdAbstractDialogFactory::Create();
                vcl::Window* pWin = GetActiveWindow();
                ScopedVclPtr<AbstractSdInsertLayerDlg> pDlg( pFact->CreateSdInsertLayerDlg(pWin ? pWin->GetFrameWeld() : nullptr, aNewAttr, bDelete, SdResId(STR_MODIFYLAYER)) );
                pDlg->SetHelpId( SdModule::get()->GetSlotPool()->GetSlot( SID_MODIFYLAYER )->GetCommand() );

                // test for already existing names
                bool    bLoop = true;
                sal_uInt16  nRet = 0;
                while( bLoop )
                {
                    nRet = pDlg->Execute();
                    if (nRet != RET_OK)
                        break;
                    pDlg->GetAttr( aNewAttr );
                    aLayerName   = aNewAttr.Get(ATTR_LAYER_NAME).GetValue ();
                    if (bDelete)
                    {
                        if( (rLayerAdmin.GetLayer( aLayerName ) && aLayerName != aOldLayerName)
                            || LayerTabBar::IsRealNameOfStandardLayer(aLayerName)
                            || LayerTabBar::IsLocalizedNameOfStandardLayer(aLayerName)
                            || aLayerName.isEmpty() )
                        {
                            // name already exists
                            std::unique_ptr<weld::MessageDialog> xWarn(Application::CreateMessageDialog(GetFrameWeld(),
                                                                   VclMessageType::Warning, VclButtonsType::Ok,
                                                                   SdResId(STR_WARN_NAME_DUPLICATE)));
                            xWarn->run();
                        }
                        else
                            bLoop = false;
                    }
                    else
                        bLoop = false; // altering name is already disabled in the dialog itself
                }
                switch (nRet)
                {
                    case RET_OK :
                        aLayerTitle  = aNewAttr.Get(ATTR_LAYER_TITLE).GetValue ();
                        aLayerDesc   = aNewAttr.Get(ATTR_LAYER_DESC).GetValue ();
                        bIsVisible   = static_cast<const SfxBoolItem &>( aNewAttr.Get (ATTR_LAYER_VISIBLE)).GetValue ();
                        bIsLocked    = static_cast<const SfxBoolItem &>( aNewAttr.Get (ATTR_LAYER_LOCKED)).GetValue ();
                        bIsPrintable = static_cast<const SfxBoolItem &>( aNewAttr.Get (ATTR_LAYER_PRINTABLE)).GetValue ();
                        break;

                    default :
                        pDlg.disposeAndClear();
                        rReq.Ignore ();
                        Cancel ();
                        return;
                }
            }
            else if (pArgs->Count () == 4)
            {
                const SfxStringItem* pLayerName = rReq.GetArg<SfxStringItem>(ID_VAL_LAYERNAME);
                const SfxBoolItem* pIsVisible = rReq.GetArg<SfxBoolItem>(ID_VAL_ISVISIBLE);
                const SfxBoolItem* pIsLocked = rReq.GetArg<SfxBoolItem>(ID_VAL_ISLOCKED);
                const SfxBoolItem* pIsPrintable = rReq.GetArg<SfxBoolItem>(ID_VAL_ISPRINTABLE);

                aLayerName   = pLayerName->GetValue ();
                bIsVisible   = pIsVisible->GetValue ();
                bIsLocked    = pIsLocked->GetValue ();
                bIsPrintable = pIsPrintable->GetValue ();
            }
            else
            {
#if HAVE_FEATURE_SCRIPTING
                StarBASIC::FatalError (ERRCODE_BASIC_WRONG_ARGS);
#endif
                Cancel ();
                rReq.Ignore ();
                break;
            }

            SfxUndoManager* pManager = GetDoc()->GetDocSh()->GetUndoManager();
            std::unique_ptr<SdLayerModifyUndoAction> pAction( new SdLayerModifyUndoAction(
                *GetDoc(),
                pLayer,
                // old values
                aOldLayerName,
                aOldLayerTitle,
                aOldLayerDesc,
                bOldIsVisible,
                bOldIsLocked,
                bOldIsPrintable,
                // new values
                aLayerName,
                aLayerTitle,
                aLayerDesc,
                bIsVisible,
                bIsLocked,
                bIsPrintable
                ) );
            pManager->AddUndoAction( std::move(pAction) );

            ModifyLayer( pLayer, aLayerName, aLayerTitle, aLayerDesc, bIsVisible, bIsLocked, bIsPrintable );

            Cancel();
            rReq.Done ();
        }
        break;

        case SID_TOGGLELAYERVISIBILITY:
        {
            // tdf#113439; duplicates LayerTabBar::MouseButtonDown()
            sal_uInt16 aTabId = GetLayerTabControl()->GetCurPageId();
            OUString aName( GetLayerTabControl()->GetLayerName(aTabId) );

            SdrPageView* pPV = mpDrawView->GetSdrPageView();
            bool bVisible = !pPV->IsLayerVisible(aName);

            pPV->SetLayerVisible(aName, bVisible);

            ResetActualLayer();
            GetDoc()->SetChanged();

            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_RENAMELAYER:
        {
            if ( mpDrawView->IsTextEdit() )
            {
                mpDrawView->SdrEndTextEdit();
            }

            if(GetLayerTabControl()) // #i87182#
            {
                GetLayerTabControl()->StartEditMode(GetLayerTabControl()->GetCurPageId());
            }
            else
            {
                OSL_ENSURE(false, "No LayerTabBar (!)");
            }

            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_EDIT_HYPERLINK :
        {
            // Ensure the field is selected first
            OutlinerView* pOutView = mpDrawView->GetTextEditOutlinerView();
            if (pOutView)
                pOutView->SelectFieldAtCursor();

            GetViewFrame()->GetDispatcher()->Execute( SID_HYPERLINK_DIALOG );

            Cancel();
            rReq.Done ();
        }
        break;

        case SID_INSERT_HYPERLINK :
        {
            GetViewFrame()->GetDispatcher()->Execute( SID_HYPERLINK_DIALOG );

            Cancel();
            rReq.Done ();
        }
        break;

        case SID_OPEN_HYPERLINK:
        {
            OutlinerView* pOutView = mpDrawView->GetTextEditOutlinerView();
            if ( pOutView )
            {
                const SvxFieldItem* pFieldItem
                    = pOutView->GetFieldAtSelection(/*AlsoCheckBeforeCursor=*/true);
                const SvxFieldData* pField = pFieldItem ? pFieldItem->GetField() : nullptr;
                if( auto pURLField = dynamic_cast< const SvxURLField *>( pField ) )
                {
                    SfxStringItem aUrl( SID_FILE_NAME, pURLField->GetURL() );
                    SfxStringItem aTarget( SID_TARGETNAME, pURLField->GetTargetFrame() );

                    OUString aReferName;
                    SfxViewFrame* pFrame = GetViewFrame();
                    SfxMedium* pMed = pFrame->GetObjectShell()->GetMedium();
                    if (pMed)
                        aReferName = pMed->GetName();

                    SfxFrameItem aFrm( SID_DOCFRAME, pFrame );
                    SfxStringItem aReferer( SID_REFERER, aReferName );

                    SfxBoolItem aNewView( SID_OPEN_NEW_VIEW, false );
                    SfxBoolItem aBrowsing( SID_BROWSE, true );

                    if (SfxViewFrame* pViewFrm = SfxViewFrame::Current())
                    {
                        pViewFrm->GetDispatcher()->ExecuteList(SID_OPENDOC,
                            SfxCallMode::ASYNCHRON | SfxCallMode::RECORD,
                            { &aUrl, &aTarget, &aFrm, &aReferer,
                                &aNewView, &aBrowsing });
                    }
                }
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_COPY_HYPERLINK_LOCATION:
        {
            OutlinerView* pOutView = mpDrawView->GetTextEditOutlinerView();
            if ( pOutView )
            {
                const SvxFieldItem* pFieldItem
                    = pOutView->GetFieldAtSelection(/*AlsoCheckBeforeCursor=*/true);
                const SvxFieldData* pField = pFieldItem ? pFieldItem->GetField() : nullptr;
                if (const SvxURLField* pURLField = dynamic_cast<const SvxURLField*>(pField))
                {
                    uno::Reference<datatransfer::clipboard::XClipboard> xClipboard
                        = pOutView->GetWindow()->GetClipboard();

                    vcl::unohelper::TextDataObject::CopyStringTo(pURLField->GetURL(), xClipboard, SfxViewShell::Current());
                }
            }

            Cancel();
            rReq.Done ();
        }
        break;

        case SID_HYPERLINK_SETLINK:
        {
            const SfxItemSet* pReqArgs = rReq.GetArgs();

            if (pReqArgs)
            {
                const SvxHyperlinkItem* pHLItem =
                    &pReqArgs->Get(SID_HYPERLINK_SETLINK);

                if (pHLItem->GetInsertMode() == HLINK_FIELD)
                {
                    InsertURLField(pHLItem->GetURL(), pHLItem->GetName(),
                                   pHLItem->GetTargetFrame(), pHLItem->GetIntName());
                }
                else if (pHLItem->GetInsertMode() == HLINK_BUTTON)
                {
                    InsertURLButton(pHLItem->GetURL(), pHLItem->GetName(),
                                    pHLItem->GetTargetFrame(), nullptr);
                }
                else if (pHLItem->GetInsertMode() == HLINK_DEFAULT)
                {
                    OutlinerView* pOlView = mpDrawView->GetTextEditOutlinerView();
                    // When the provided text is just a hint, prefer the selection over it; if both
                    // are missing, use the URL.
                    OUString sLinkText;
                    if (pHLItem->GetTextIsHint() && pOlView && pOlView->HasSelection())
                        sLinkText = pOlView->GetSelected();
                    else if (!pHLItem->GetName().isEmpty())
                        sLinkText = pHLItem->GetName();
                    else
                        sLinkText = pHLItem->GetURL();

                    if (pOlView || comphelper::COKit::isActive())
                    {
                        InsertURLField(pHLItem->GetURL(), sLinkText,
                                       pHLItem->GetTargetFrame(), pHLItem->GetIntName());
                    }
                    else
                    {
                        InsertURLButton(pHLItem->GetURL(), pHLItem->GetName(),
                                        pHLItem->GetTargetFrame(), nullptr);
                    }
                }
            }

            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_HIDE_LAST_LEVEL:
        {
            ESelection aSel;
            // fdo#78151 editing a PresObjKind::Outline in a master page ?
            ::Outliner* pOL = GetOutlinerForMasterPageOutlineTextObj(aSel);
            if (pOL)
            {
                //we are on the last paragraph
                aSel.Adjust();
                if (aSel.end.nPara == pOL->GetParagraphCount() - 1)
                {
                    sal_uInt16 nDepth = pOL->GetDepth(aSel.end.nPara);
                    //there exists a previous numbering level
                    if (nDepth != sal_uInt16(-1) && nDepth > 0)
                    {
                        Paragraph* pPara = pOL->GetParagraph(aSel.end.nPara);
                        pOL->Remove(pPara, 1);
                    }
                }
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_SHOW_NEXT_LEVEL:
        {
            const TranslateId STR_PRESOBJ_MPOUTLINE_ARY[]
            {
                STR_PRESOBJ_MPOUTLINE,
                STR_PRESOBJ_MPOUTLLAYER2,
                STR_PRESOBJ_MPOUTLLAYER3,
                STR_PRESOBJ_MPOUTLLAYER4,
                STR_PRESOBJ_MPOUTLLAYER5,
                STR_PRESOBJ_MPOUTLLAYER6,
                STR_PRESOBJ_MPOUTLLAYER7,
                STR_PRESOBJ_MPNOTESTITLE,
                STR_PRESOBJ_MPNOTESTEXT,
                STR_PRESOBJ_NOTESTEXT
            };

            ESelection aSel;
            // fdo#78151 editing a PresObjKind::Outline in a master page ?
            ::Outliner* pOL = GetOutlinerForMasterPageOutlineTextObj(aSel);
            if (pOL)
            {
                //we are on the last paragraph
                aSel.Adjust();
                if (aSel.end.nPara == pOL->GetParagraphCount() - 1)
                {
                    sal_uInt16 nDepth = pOL->GetDepth(aSel.end.nPara);
                    //there exists a previous numbering level
                    if (nDepth < 8)
                    {
                        sal_uInt16 nNewDepth = nDepth+1;
                        pOL->Insert(SdResId(STR_PRESOBJ_MPOUTLINE_ARY[nNewDepth]), EE_PARA_MAX, nNewDepth);
                    }
                }
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_INSERT_FLD_DATE_FIX:
        case SID_INSERT_FLD_DATE_VAR:
        case SID_INSERT_FLD_TIME_FIX:
        case SID_INSERT_FLD_TIME_VAR:
        case SID_INSERT_FLD_AUTHOR:
        case SID_INSERT_FLD_PAGE:
        case SID_INSERT_FLD_PAGE_TITLE:
        case SID_INSERT_FLD_PAGES:
        case SID_INSERT_FLD_FILE:
        {
            sal_uInt16 nMul = 1;
            std::unique_ptr<SvxFieldItem> pFieldItem;

            switch( nSId )
            {
                case SID_INSERT_FLD_DATE_FIX:
                    pFieldItem.reset(new SvxFieldItem(
                        SvxDateField( Date( Date::SYSTEM ), SvxDateType::Fix ), EE_FEATURE_FIELD ));
                break;

                case SID_INSERT_FLD_DATE_VAR:
                    pFieldItem.reset(new SvxFieldItem( SvxDateField(), EE_FEATURE_FIELD ));
                break;

                case SID_INSERT_FLD_TIME_FIX:
                    pFieldItem.reset(new SvxFieldItem(
                        SvxExtTimeField( ::tools::Time( ::tools::Time::SYSTEM ), SvxTimeType::Fix ), EE_FEATURE_FIELD ));
                break;

                case SID_INSERT_FLD_TIME_VAR:
                    pFieldItem.reset(new SvxFieldItem( SvxExtTimeField(), EE_FEATURE_FIELD ));
                break;

                case SID_INSERT_FLD_AUTHOR:
                {
                    SvtUserOptions aUserOptions;
                    pFieldItem.reset(new SvxFieldItem(
                            SvxAuthorField(
                                aUserOptions.GetFirstName(), aUserOptions.GetLastName(), aUserOptions.GetID() ), EE_FEATURE_FIELD ));
                }
                break;

                case SID_INSERT_FLD_PAGE:
                {
                    pFieldItem.reset(new SvxFieldItem( SvxPageField(), EE_FEATURE_FIELD ));
                    nMul = 3;
                }
                break;

                case SID_INSERT_FLD_PAGE_TITLE:
                {
                    pFieldItem.reset(new SvxFieldItem( SvxPageTitleField(), EE_FEATURE_FIELD));
                    nMul = 3;
                }
                break;

                case SID_INSERT_FLD_PAGES:
                {
                    pFieldItem.reset(new SvxFieldItem( SvxPagesField(), EE_FEATURE_FIELD ));
                    nMul = 3;
                }
                break;

                case SID_INSERT_FLD_FILE:
                {
                    OUString aName;
                    if( GetDocSh()->HasName() )
                        aName = GetDocSh()->GetMedium()->GetName();
                    pFieldItem.reset(new SvxFieldItem( SvxExtFileField( aName ), EE_FEATURE_FIELD ));
                }
                break;
            }

            OutlinerView* pOLV = mpDrawView->GetTextEditOutlinerView();

            if( pOLV )
            {
                const SvxFieldItem* pOldFldItem = pOLV->GetFieldAtSelection();

                if( pOldFldItem && ( nullptr != dynamic_cast< const SvxURLField *>( pOldFldItem->GetField() ) ||
                                    nullptr != dynamic_cast< const SvxDateField *>( pOldFldItem->GetField() ) ||
                                    nullptr != dynamic_cast< const SvxTimeField *>( pOldFldItem->GetField() ) ||
                                    nullptr != dynamic_cast< const SvxExtTimeField *>( pOldFldItem->GetField() ) ||
                                    nullptr != dynamic_cast< const SvxExtFileField *>( pOldFldItem->GetField() ) ||
                                    nullptr != dynamic_cast< const SvxAuthorField *>( pOldFldItem->GetField() ) ||
                                    nullptr != dynamic_cast< const SvxPageField *>( pOldFldItem->GetField() ) ) )
                {
                    // select field, then it will be deleted when inserting
                    ESelection aSel = pOLV->GetSelection();
                    if (aSel.start.nIndex == aSel.end.nIndex)
                        aSel.end.nIndex++;
                    pOLV->SetSelection( aSel );
                }

                if( pFieldItem )
                    pOLV->InsertField( *pFieldItem );
            }
            else
            {
                Outliner* pOutl = GetDoc()->GetInternalOutliner();
                pOutl->Init( OutlinerMode::TextObject );
                OutlinerMode nOutlMode = pOutl->GetOutlinerMode();
                pOutl->SetStyleSheet( 0, nullptr );
                pOutl->QuickInsertField( *pFieldItem, ESelection() );
                std::optional<OutlinerParaObject> pOutlParaObject = pOutl->CreateParaObject();

                rtl::Reference<SdrRectObj> pRectObj = new SdrRectObj(
                    *GetDoc(), ::tools::Rectangle(), SdrObjKind::Text);
                pRectObj->SetMergedItem(makeSdrTextAutoGrowWidthItem(true));

                pOutl->UpdateFields();
                pOutl->SetUpdateLayout( true );
                Size aSize( pOutl->CalcTextSize() );
                aSize.setWidth( aSize.Width() * nMul );
                pOutl->SetUpdateLayout( false );

                Point aPos;
                ::tools::Rectangle aRect( aPos, GetActiveWindow()->GetOutputSizePixel() );
                aPos = aRect.Center();
                aPos = GetActiveWindow()->PixelToLogic(aPos);
                aPos.AdjustX( -(aSize.Width() / 2) );
                aPos.AdjustY( -(aSize.Height() / 2) );

                ::tools::Rectangle aLogicRect(aPos, aSize);
                pRectObj->SetLogicRect(aLogicRect);
                pRectObj->SetOutlinerParaObject( std::move(pOutlParaObject) );
                mpDrawView->InsertObjectAtView(pRectObj.get(), *mpDrawView->GetSdrPageView());
                pOutl->Init( nOutlMode );
            }

            pFieldItem.reset();

            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_MODIFY_FIELD:
        {
            OutlinerView* pOLV = mpDrawView->GetTextEditOutlinerView();

            if( pOLV )
            {
                const SvxFieldItem* pFldItem = pOLV->GetFieldAtSelection();

                if( pFldItem && (nullptr != dynamic_cast< const SvxDateField *>( pFldItem->GetField() ) ||
                                 nullptr != dynamic_cast< const SvxAuthorField *>( pFldItem->GetField() ) ||
                                 nullptr != dynamic_cast< const SvxExtFileField *>( pFldItem->GetField() ) ||
                                 nullptr != dynamic_cast< const SvxExtTimeField *>( pFldItem->GetField() ) ) )
                {
                    // Dialog...
                    SdAbstractDialogFactory* pFact = SdAbstractDialogFactory::Create();
                    vcl::Window* pWin = GetActiveWindow();
                    ScopedVclPtr<AbstractSdModifyFieldDlg> pDlg( pFact->CreateSdModifyFieldDlg(pWin ? pWin->GetFrameWeld() : nullptr, pFldItem->GetField(), pOLV->GetAttribs() ) );
                    if( pDlg->Execute() == RET_OK )
                    {
                        // To make a correct SetAttribs() call at the utlinerView
                        // it is necessary to split the actions here
                        std::unique_ptr<SvxFieldData> pField(pDlg->GetField());
                        ESelection aSel = pOLV->GetSelection();
                        bool bSelectionWasModified(false);

                        if( pField )
                        {
                            SvxFieldItem aFieldItem( *pField, EE_FEATURE_FIELD );

                            if (aSel.start.nIndex == aSel.end.nIndex)
                            {
                                bSelectionWasModified = true;
                                aSel.end.nIndex++;
                                pOLV->SetSelection( aSel );
                            }

                            pOLV->InsertField( aFieldItem );

                            // select again for eventual SetAttribs call
                            pOLV->SetSelection( aSel );
                        }

                        SfxItemSet aSet( pDlg->GetItemSet() );

                        if( aSet.Count() )
                        {
                            pOLV->SetAttribs( aSet );

                            ::Outliner& rOutliner = pOLV->GetOutliner();
                            rOutliner.UpdateFields();
                        }

                        if(pField)
                        {
                            // restore selection to original
                            if(bSelectionWasModified)
                            {
                                aSel.end.nIndex--;
                                pOLV->SetSelection( aSel );
                            }
                        }
                    }
                }
            }

            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_OPEN_XML_FILTERSETTINGS:
        {
            try
            {
                css::uno::Reference < css::ui::dialogs::XExecutableDialog > xDialog = css::ui::dialogs::XSLTFilterDialog::create( ::comphelper::getProcessComponentContext() );
                xDialog->execute();
            }
            catch( css::uno::RuntimeException& )
            {
                DBG_UNHANDLED_EXCEPTION("sd.view");
            }

            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_GROUP:  // BASIC
        {
            if ( mpDrawView->IsPresObjSelected( true, true, true ) )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                mpDrawView->GroupMarked();
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_UNGROUP:  // BASIC
        {
            mpDrawView->UnGroupMarked();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_NAME_GROUP:
        {
            // only allow for single object selection since the name of an object needs
            // to be unique
            if(1 == rMarkList.GetMarkCount())
            {
                // #i68101#
                rtl::Reference<SdrObject> pSelected = rMarkList.GetMark(0)->GetMarkedSdrObj();
                OSL_ENSURE(pSelected, "DrawViewShell::FuTemp03: nMarkCount, but no object (!)");
                OUString aName(pSelected->GetName());

                SvxAbstractDialogFactory* pFact = SvxAbstractDialogFactory::Create();
                VclPtr<AbstractSvxObjectNameDialog> pDlg(pFact->CreateSvxObjectNameDialog(GetFrameWeld(), aName));

                pDlg->SetCheckNameHdl(LINK(this, DrawViewShell, NameObjectHdl));

                pDlg->StartExecuteAsync(
                    [this, pDlg, pSelected] (sal_Int32 nResult)->void
                    {
                        if (nResult == RET_OK)
                        {
                            pSelected->SetName(pDlg->GetName());

                            SdPage* pPage = GetActualPage();
                            if (pPage)
                                pPage->notifyObjectRenamed(pSelected.get());
                        }
                        pDlg->disposeOnce();
                        SfxBindings& rBindings = GetViewFrame()->GetBindings();
                        rBindings.Invalidate( SID_NAVIGATOR_STATE, true );
                        rBindings.Invalidate( SID_CONTEXT );
                    }
                );
            }

            Cancel();
            rReq.Ignore();
            break;
        }

        // #i68101#
        case SID_OBJECT_TITLE_DESCRIPTION:
        {
            if(1 == rMarkList.GetMarkCount())
            {
                rtl::Reference<SdrObject> pSelected = rMarkList.GetMark(0)->GetMarkedSdrObj();
                OSL_ENSURE(pSelected, "DrawViewShell::FuTemp03: nMarkCount, but no object (!)");
                OUString aTitle(pSelected->GetTitle());
                OUString aDescription(pSelected->GetDescription());
                bool isDecorative(pSelected->IsDecorative());

                SvxAbstractDialogFactory* pFact = SvxAbstractDialogFactory::Create();
                VclPtr<AbstractSvxObjectTitleDescDialog> pDlg(pFact->CreateSvxObjectTitleDescDialog(
                            GetFrameWeld(), aTitle, aDescription, isDecorative));

                pDlg->StartExecuteAsync(
                    [this, pDlg, pSelected] (sal_Int32 nResult)->void
                    {
                        if (nResult == RET_OK)
                        {
                            pSelected->SetTitle(pDlg->GetTitle());
                            pSelected->SetDescription(pDlg->GetDescription());
                            pSelected->SetDecorative(pDlg->IsDecorative());
                        }
                        pDlg->disposeOnce();
                        SfxBindings& rBindings = GetViewFrame()->GetBindings();
                        rBindings.Invalidate( SID_NAVIGATOR_STATE, true );
                        rBindings.Invalidate( SID_CONTEXT );
                    }
                );
            }

            Cancel();
            rReq.Ignore();
            break;
        }

        case SID_SETLAYER:
        {
            const size_t nMarkCount = rMarkList.GetMarkCount();
            if (nMarkCount >= 1 && mpLayerTabBar)
            {
                SdSelectLayerDlg aDlg(GetFrameWeld());

                weld::TreeView& rTreeView = aDlg.GetTreeView();
                auto nPageCount = mpLayerTabBar->GetPageCount();
                for (auto i = 0; i < nPageCount; i++)
                    rTreeView.append_text(LayerTabBar::convertToLocalizedName(
                                        mpLayerTabBar->GetLayerName(mpLayerTabBar->GetPageId(i))));
                rTreeView.select(0);

                if (aDlg.run() == RET_OK && rTreeView.get_selected_index() != -1)
                {
                    SdrLayerAdmin& rLayerAdmin = GetDoc()->GetLayerAdmin();
                    SdrLayerID aSdrLayerId = rLayerAdmin.GetLayerID(mpLayerTabBar->GetLayerName(
                                        mpLayerTabBar->GetPageId(rTreeView.get_selected_index())));
                    for (size_t i = 0; i < nMarkCount; ++i)
                    {
                        SdrObject* pObj = rMarkList.GetMark(i)->GetMarkedSdrObj();
                        pObj->SetLayer(aSdrLayerId);
                    }
                }
            }
            Cancel();
            rReq.Ignore();
            break;
        }

        case SID_ENTER_GROUP:  // BASIC
        {
            mpDrawView->EnterMarkedGroup();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_LEAVE_GROUP:  // BASIC
        {
            mpDrawView->LeaveOneGroup();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_LEAVE_ALL_GROUPS:  // BASIC
        {
            mpDrawView->LeaveAllGroup();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_TEXT_COMBINE:  // BASIC
        {
            // End text edit to avoid conflicts
            if(mpDrawView->IsTextEdit())
                mpDrawView->SdrEndTextEdit();

            if ( mpDrawView->IsPresObjSelected() )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                weld::WaitObject aWait(GetFrameWeld());
                mpDrawView->CombineMarkedTextObjects();
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_COMBINE:  // BASIC
        {
            // End text edit to avoid conflicts
            if(mpDrawView->IsTextEdit())
                mpDrawView->SdrEndTextEdit();

            if ( mpDrawView->IsPresObjSelected() )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                weld::WaitObject aWait(GetFrameWeld());
                mpDrawView->CombineMarkedObjects(false);
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_DISTRIBUTE_HLEFT:
        case SID_DISTRIBUTE_HCENTER:
        case SID_DISTRIBUTE_HDISTANCE:
        case SID_DISTRIBUTE_HRIGHT:
        case SID_DISTRIBUTE_VTOP:
        case SID_DISTRIBUTE_VCENTER:
        case SID_DISTRIBUTE_VDISTANCE:
        case SID_DISTRIBUTE_VBOTTOM:
        {
            if ( mpDrawView->IsPresObjSelected() )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                mpDrawView->DistributeMarkedObjects(nSId);
            }
            Cancel();
            rReq.Done ();
        }
        break;
        case SID_POLY_MERGE:
        {
            // End text edit to avoid conflicts
            if(mpDrawView->IsTextEdit())
                mpDrawView->SdrEndTextEdit();

            if ( mpDrawView->IsPresObjSelected() )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                weld::WaitObject aWait(GetFrameWeld());
                mpDrawView->MergeMarkedObjects(SdrMergeMode::Merge);
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_POLY_SUBSTRACT:
        {
            // End text edit to avoid conflicts
            if(mpDrawView->IsTextEdit())
                mpDrawView->SdrEndTextEdit();

            if ( mpDrawView->IsPresObjSelected() )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                weld::WaitObject aWait(GetFrameWeld());
                mpDrawView->MergeMarkedObjects(SdrMergeMode::Subtract);
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_POLY_INTERSECT:
        {
            // End text edit to avoid conflicts
            if(mpDrawView->IsTextEdit())
                mpDrawView->SdrEndTextEdit();

            if ( mpDrawView->IsPresObjSelected() )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                weld::WaitObject aWait(GetFrameWeld());
                mpDrawView->MergeMarkedObjects(SdrMergeMode::Intersect);
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_EQUALIZEWIDTH:
        case SID_EQUALIZEHEIGHT:
        {
            // End text edit to avoid conflicts
            if(mpDrawView->IsTextEdit())
                mpDrawView->SdrEndTextEdit();

            mpDrawView->EqualizeMarkedObjects(nSId == SID_EQUALIZEWIDTH);
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_DISMANTLE:  // BASIC
        {
            if ( mpDrawView->IsDismantlePossible() )
            {
                weld::WaitObject aWait(GetFrameWeld());
                mpDrawView->DismantleMarkedObjects();
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_CONNECT:  // BASIC
        {
            if ( mpDrawView->IsPresObjSelected() )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                weld::WaitObject aWait(GetFrameWeld());
                mpDrawView->CombineMarkedObjects();
            }
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_BREAK:  // BASIC
        {
            if ( mpDrawView->IsTextEdit() )
            {
                mpDrawView->SdrEndTextEdit();
            }

            if ( mpDrawView->IsBreak3DObjPossible() )
            {
                weld::WaitObject aWait(GetFrameWeld());
                mpDrawView->Break3DObj();
            }
            else if ( mpDrawView->IsDismantlePossible(true) )
            {
                weld::WaitObject aWait(GetFrameWeld());
                mpDrawView->DismantleMarkedObjects(true);
            }
            else if ( mpDrawView->IsImportMtfPossible() )
            {
                weld::WaitObject aWait(GetFrameWeld());
                const size_t nCnt=rMarkList.GetMarkCount();

                // determine the sum of meta objects of all selected meta files
                sal_uLong nCount = 0;
                for(size_t nm=0; nm<nCnt; ++nm)
                {
                    SdrMark*     pM=rMarkList.GetMark(nm);
                    SdrObject*   pObj=pM->GetMarkedSdrObj();
                    SdrGrafObj*  pGraf= dynamic_cast< SdrGrafObj *>( pObj );
                    SdrOle2Obj*  pOle2= dynamic_cast< SdrOle2Obj *>( pObj );

                    if (pGraf != nullptr)
                    {
                        if (pGraf->HasGDIMetaFile())
                        {
                            nCount += pGraf->GetGraphic().GetGDIMetaFile().GetActionSize();
                        }
                        else if (pGraf->isEmbeddedVectorGraphicData())
                        {
                            nCount += pGraf->getMetafileFromEmbeddedVectorGraphicData().GetActionSize();
                        }
                    }

                    if (pOle2)
                        if (const Graphic* pGraphic = pOle2->GetGraphic())
                            nCount += pGraphic->GetGDIMetaFile().GetActionSize();
                }

                // decide with the sum of all meta objects if we should show a dialog
                if(nCount < MIN_ACTIONS_FOR_DIALOG)
                {
                    // nope, no dialog
                    mpDrawView->DoImportMarkedMtf();
                }
                else
                {
                    SdAbstractDialogFactory* pFact = SdAbstractDialogFactory::Create();
                    ScopedVclPtr<VclAbstractDialog> pDlg(pFact->CreateBreakDlg(GetFrameWeld(), mpDrawView.get(), GetDocSh(), nCount, static_cast<sal_uLong>(nCnt) ));
                    pDlg->Execute();
                }
            }

            Cancel();
            rReq.Done ();
        }
        break;

        case SID_CONVERT_TO_3D:
        {
            if ( mpDrawView->IsPresObjSelected() )
            {
                std::unique_ptr<weld::MessageDialog> xInfoBox(Application::CreateMessageDialog(GetFrameWeld(),
                                                              VclMessageType::Info, VclButtonsType::Ok,
                                                              SdResId(STR_ACTION_NOTPOSSIBLE)));
                xInfoBox->run();
            }
            else
            {
                if (mpDrawView->IsConvertTo3DObjPossible())
                {
                    if (mpDrawView->IsTextEdit())
                    {
                        mpDrawView->SdrEndTextEdit();
                    }

                    weld::WaitObject aWait(GetFrameWeld());
                    mpDrawView->ConvertMarkedObjTo3D();
                }
            }

            Cancel();
            rReq.Done();
        }
        break;

        case SID_FRAME_TO_TOP:  // BASIC
        {
            mpDrawView->PutMarkedToTop();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_MOREFRONT:  // BASIC
        case SID_FRAME_UP:  // BASIC
        {
            mpDrawView->MovMarkedToTop();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_MOREBACK:  // BASIC
        case SID_FRAME_DOWN:  // BASIC
        {
            mpDrawView->MovMarkedToBtm();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_FRAME_TO_BOTTOM:   // BASIC
        {
            mpDrawView->PutMarkedToBtm();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_HORIZONTAL:  // BASIC
        case SID_FLIP_HORIZONTAL:
        {
            mpDrawView->MirrorAllMarkedHorizontal();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_VERTICAL:  // BASIC
        case SID_FLIP_VERTICAL:
        {
            mpDrawView->MirrorAllMarkedVertical();
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_OBJECT_ALIGN_LEFT:  // BASIC
        {
            mpDrawView->AlignMarkedObjects(SdrHorAlign::Left, SdrVertAlign::NONE);
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_OBJECT_ALIGN_CENTER:  // BASIC
        {
            mpDrawView->AlignMarkedObjects(SdrHorAlign::Center, SdrVertAlign::NONE);
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_OBJECT_ALIGN_RIGHT:  // BASIC
        {
            mpDrawView->AlignMarkedObjects(SdrHorAlign::Right, SdrVertAlign::NONE);
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_OBJECT_ALIGN_UP:  // BASIC
        {
            mpDrawView->AlignMarkedObjects(SdrHorAlign::NONE, SdrVertAlign::Top);
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_OBJECT_ALIGN_MIDDLE:  // BASIC
        {
            mpDrawView->AlignMarkedObjects(SdrHorAlign::NONE, SdrVertAlign::Center);
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_ALIGN_PAGE:
        {
            mpDrawView->AlignMarkedObjects(SdrHorAlign::Center, SdrVertAlign::Center);
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_OBJECT_ALIGN_DOWN:  // BASIC
        {
            mpDrawView->AlignMarkedObjects(SdrHorAlign::NONE, SdrVertAlign::Bottom);
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_SELECTALL:  // BASIC
        {
            if( (dynamic_cast<FuSelection*>( GetOldFunction().get() ) != nullptr) &&
                !GetView()->IsFrameDragSingles() && GetView()->HasMarkablePoints())
            {
                if ( !mpDrawView->IsAction() )
                    mpDrawView->MarkAllPoints();
            }
            else
                mpDrawView->SelectAll();

            FreshNavigatrTree();

            Cancel();
            rReq.Done ();
        }
        break;

        case SID_STYLE_NEW: // BASIC ???
        case SID_STYLE_APPLY:
        case SID_STYLE_EDIT:
        case SID_STYLE_DELETE:
        case SID_STYLE_HIDE:
        case SID_STYLE_SHOW:
        case SID_STYLE_FAMILY:
        case SID_STYLE_WATERCAN:
        case SID_STYLE_UPDATE_BY_EXAMPLE:
        case SID_STYLE_NEW_BY_EXAMPLE:
        {
            if (!rReq.GetArgs()
                && (nSId == SID_STYLE_EDIT || nSId == SID_STYLE_UPDATE_BY_EXAMPLE
                     || nSId == SID_STYLE_NEW_BY_EXAMPLE))
            {
                SfxStyleSheet* pStyleSheet = mpDrawView->GetStyleSheet();
                if( pStyleSheet && pStyleSheet->GetFamily() == SfxStyleFamily::Page)
                    pStyleSheet = static_cast<SdStyleSheet*>(pStyleSheet)->GetPseudoStyleSheet();

                if( (pStyleSheet == nullptr) && GetView()->IsTextEdit() )
                {
                    GetView()->SdrEndTextEdit();

                    pStyleSheet = mpDrawView->GetStyleSheet();
                    if(pStyleSheet && pStyleSheet->GetFamily() == SfxStyleFamily::Page)
                        pStyleSheet = static_cast<SdStyleSheet*>(pStyleSheet)->GetPseudoStyleSheet();
                }

                if( pStyleSheet == nullptr )
                {
                    rReq.Ignore();
                    break;
                }

                SfxAllItemSet aSet(GetDoc()->GetPool());

                aSet.Put(SfxUInt16Item(SID_STYLE_FAMILY,
                                       static_cast<sal_uInt16>(pStyleSheet->GetFamily())));

                if (nSId == SID_STYLE_NEW_BY_EXAMPLE)
                {
                    weld::Window* pWindow = GetViewFrame()->GetFrameWeld();
                    std::shared_ptr<SfxNewStyleDlg> xDlg(
                        new SfxNewStyleDlg(pWindow, *pStyleSheet->GetPool(),
                                           pStyleSheet->GetFamily()));
                    OUString aStyleName = pStyleSheet->GetName();
                    weld::GenericDialogController::runAsync(
                        xDlg, [this, xDlg, aSet, aStyleName, nSId](sal_Int32 nResult) mutable {
                            if (nResult == RET_OK)
                            {
                                aSet.Put(SfxStringItem(SID_STYLE_NEW_BY_EXAMPLE,
                                                       xDlg->GetName()));
                                aSet.Put(SfxStringItem(SID_STYLE_REFERENCE, aStyleName));
                                SfxRequest aReq(*GetViewFrame(), nSId);
                                aReq.SetArgs(aSet);
                                SetCurrentFunction(FuTemplate::Create(
                                    *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), aReq));
                            }
                            Cancel();
                        });
                    rReq.Ignore();
                    break;
                }

                aSet.Put(SfxStringItem(nSId, pStyleSheet->GetName()));

                rReq.SetArgs(aSet);
            }

            if( rReq.GetArgs() )
            {
                SetCurrentFunction( FuTemplate::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
                if( rReq.GetSlot() == SID_STYLE_APPLY )
                    GetViewFrame()->GetBindings().Invalidate( SID_STYLE_APPLY );
                Cancel();
            }
            else if( rReq.GetSlot() == SID_STYLE_APPLY )
                GetViewFrame()->GetDispatcher()->Execute( SID_STYLE_DESIGNER, SfxCallMode::ASYNCHRON );
            rReq.Ignore ();
        }
        break;

        case SID_IMAP:
        {
            sal_uInt16      nId = SvxIMapDlgChildWindow::GetChildWindowId();

            GetViewFrame()->ToggleChildWindow( nId );
            GetViewFrame()->GetBindings().Invalidate( SID_IMAP );

            if ( GetViewFrame()->HasChildWindow( nId )
                && ( ( ViewShell::Implementation::GetImageMapDialog() ) != nullptr ) )
            {
                if ( rMarkList.GetMarkCount() == 1 )
                    UpdateIMapDlg( rMarkList.GetMark( 0 )->GetMarkedSdrObj() );
            }

            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_GRID_FRONT:
        {
            mpDrawView->SetGridFront( !mpDrawView->IsGridFront() );
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_HELPLINES_FRONT:
        {
            mpDrawView->SetHlplFront( !mpDrawView->IsHlplFront() );
            Cancel();
            rReq.Done ();
        }
        break;

        case SID_FONTWORK:
        {
            if ( rReq.GetArgs() )
            {
                GetViewFrame()->SetChildWindow(SvxFontWorkChildWindow::GetChildWindowId(),
                                        static_cast<const SfxBoolItem&>(rReq.GetArgs()->
                                        Get(SID_FONTWORK)).GetValue());
            }
            else
            {
                GetViewFrame()->ToggleChildWindow( SvxFontWorkChildWindow::GetChildWindowId() );
            }

            GetViewFrame()->GetBindings().Invalidate(SID_FONTWORK);
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_COLOR_CONTROL:
        {
            if ( rReq.GetArgs() )
                GetViewFrame()->SetChildWindow(SvxColorChildWindow::GetChildWindowId(),
                                        rReq.GetArgs()->Get(SID_COLOR_CONTROL).GetValue());
            else
                GetViewFrame()->ToggleChildWindow(SvxColorChildWindow::GetChildWindowId() );

            GetViewFrame()->GetBindings().Invalidate(SID_COLOR_CONTROL);
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_EXTRUSION_TOGGLE:
        case SID_EXTRUSION_TILT_DOWN:
        case SID_EXTRUSION_TILT_UP:
        case SID_EXTRUSION_TILT_LEFT:
        case SID_EXTRUSION_TILT_RIGHT:
        case SID_EXTRUSION_3D_COLOR:
        case SID_EXTRUSION_DEPTH:
        case SID_EXTRUSION_DIRECTION:
        case SID_EXTRUSION_PROJECTION:
        case SID_EXTRUSION_LIGHTING_DIRECTION:
        case SID_EXTRUSION_LIGHTING_INTENSITY:
        case SID_EXTRUSION_SURFACE:
        case SID_EXTRUSION_DEPTH_FLOATER:
        case SID_EXTRUSION_DIRECTION_FLOATER:
        case SID_EXTRUSION_LIGHTING_FLOATER:
        case SID_EXTRUSION_SURFACE_FLOATER:
        case SID_EXTRUSION_DEPTH_DIALOG:
            svx::ExtrusionBar::execute( mpDrawView.get(), rReq, GetViewFrame()->GetBindings() );
            Cancel();
            rReq.Ignore ();
            break;

        case SID_FONTWORK_SHAPE:
        case SID_FONTWORK_SHAPE_TYPE:
        case SID_FONTWORK_ALIGNMENT:
        case SID_FONTWORK_SAME_LETTER_HEIGHTS:
        case SID_FONTWORK_CHARACTER_SPACING:
        case SID_FONTWORK_KERN_CHARACTER_PAIRS:
        case SID_FONTWORK_GALLERY_FLOATER:
        case SID_FONTWORK_CHARACTER_SPACING_FLOATER:
        case SID_FONTWORK_ALIGNMENT_FLOATER:
        case SID_FONTWORK_CHARACTER_SPACING_DIALOG:
            svx::FontworkBar::execute(*mpDrawView, rReq, GetViewFrame()->GetBindings());
            Cancel();
            rReq.Ignore ();
            break;

        case SID_BMPMASK:
        {
            GetViewFrame()->ToggleChildWindow( SvxBmpMaskChildWindow::GetChildWindowId() );
            GetViewFrame()->GetBindings().Invalidate( SID_BMPMASK );

            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_NAVIGATOR:
        {
            if ( rReq.GetArgs() )
                GetViewFrame()->SetChildWindow(SID_NAVIGATOR,
                                        static_cast<const SfxBoolItem&>(rReq.GetArgs()->
                                        Get(SID_NAVIGATOR)).GetValue());
            else
                GetViewFrame()->ToggleChildWindow( SID_NAVIGATOR );

            GetViewFrame()->GetBindings().Invalidate(SID_NAVIGATOR);
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_SLIDE_TRANSITIONS_PANEL:
        case SID_MASTER_SLIDES_PANEL:
        case SID_CUSTOM_ANIMATION_PANEL:
        case SID_GALLERY:
        {
            // First make sure that the sidebar is visible
            GetViewFrame()->ShowChildWindow(SID_SIDEBAR);

            OUString panelId;
            if (nSId == SID_CUSTOM_ANIMATION_PANEL)
                panelId = u"SdCustomAnimationPanel"_ustr;
            else if (nSId == SID_GALLERY)
                panelId = u"GalleryPanel"_ustr;
            else if (nSId == SID_SLIDE_TRANSITIONS_PANEL)
                panelId = u"SdSlideTransitionPanel"_ustr;
            else if (nSId == SID_MASTER_SLIDES_PANEL)
                panelId = u"SdAllMasterPagesPanel"_ustr;

            ::sfx2::sidebar::Sidebar::TogglePanel(
                panelId,
                GetViewFrame()->GetFrame().GetFrameInterface());

            Cancel();
            rReq.Done();
        }
        break;

        case SID_ANIMATION_OBJECTS:
        {
            if ( rReq.GetArgs() )
                GetViewFrame()->SetChildWindow(
                    AnimationChildWindow::GetChildWindowId(),
                    static_cast<const SfxBoolItem&>(rReq.GetArgs()->
                        Get(SID_ANIMATION_OBJECTS)).GetValue());
            else
                GetViewFrame()->ToggleChildWindow(
                    AnimationChildWindow::GetChildWindowId() );

            GetViewFrame()->GetBindings().Invalidate(SID_ANIMATION_OBJECTS);
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_3D_WIN:
        {
            if ( rReq.GetArgs() )
                GetViewFrame()->SetChildWindow( Svx3DChildWindow::GetChildWindowId(),
                                        static_cast<const SfxBoolItem&>(rReq.GetArgs()->
                                        Get( SID_3D_WIN )).GetValue());
            else
                GetViewFrame()->ToggleChildWindow( Svx3DChildWindow::GetChildWindowId() );

            GetViewFrame()->GetBindings().Invalidate( SID_3D_WIN );
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_CONVERT_TO_3D_LATHE_FAST:
        {
            /* The call is enough. The initialization via Start3DCreation and
               CreateMirrorPolygons is no longer needed if the parameter
               true is provided. Then a tilted rotary body with an axis left
               besides the bounding rectangle of the selected objects is drawn
               immediately and without user interaction.  */
            mpDrawView->SdrEndTextEdit();
            if(GetActiveWindow())
                GetActiveWindow()->EnterWait();
            mpDrawView->End3DCreation(true);
            Cancel();
            rReq.Ignore();
            if(GetActiveWindow())
                GetActiveWindow()->LeaveWait();
        }
        break;

        case SID_PRESENTATION_DLG:
        {
            SetCurrentFunction( FuSlideShowDlg::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
        }
        break;

        case SID_REMOTE_DLG:
        {
#ifdef ENABLE_SDREMOTE
             SdAbstractDialogFactory* pFact = SdAbstractDialogFactory::Create();
             ScopedVclPtr<VclAbstractDialog> pDlg(pFact->CreateRemoteDialog(GetFrameWeld()));
             pDlg->Execute();
#endif
        }
        break;

        case SID_CUSTOMSHOW_DLG:
        {
            SetCurrentFunction( FuCustomShowDlg::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
        }
        break;

        case SID_EXPAND_PAGE:
        {
            SetCurrentFunction( FuExpandPage::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
        }
        break;

        case SID_SUMMARY_PAGE:
        {
            mpDrawView->SdrEndTextEdit();
            SetCurrentFunction( FuSummaryPage::Create( *this, GetActiveWindow(), mpDrawView.get(), *GetDoc(), rReq ) );
            Cancel();
        }
        break;

#if HAVE_FEATURE_AVMEDIA
        case SID_AVMEDIA_PLAYER:
        {
            GetViewFrame()->ToggleChildWindow( ::avmedia::MediaPlayer::GetChildWindowId() );
            GetViewFrame()->GetBindings().Invalidate( SID_AVMEDIA_PLAYER );
            Cancel();
            rReq.Ignore ();
        }
        break;
#endif

        case SID_PRESENTATION_MINIMIZER:
        {
            const Reference<XComponentContext>& xContext(::comphelper::getProcessComponentContext());
            Reference<util::XURLTransformer> xParser(util::URLTransformer::create(xContext));
            Reference<frame::XDispatchProvider> xProvider(GetViewShellBase().GetController()->getFrame(), UNO_QUERY);
            if (xProvider.is())
            {
                util::URL aURL;
                aURL.Complete = u"vnd.com.sun.star.comp.PresentationMinimizer:execute"_ustr;
                xParser->parseStrict(aURL);
                uno::Reference<frame::XDispatch> xDispatch(xProvider->queryDispatch(aURL, OUString(), 0));
                if (xDispatch.is())
                {
                    xDispatch->dispatch(aURL, cpo::uno::Sequence< beans::PropertyValue >());
                }
            }
            Cancel();
            rReq.Ignore();
        }
        break;

        case SID_DISPLAY_MASTER_BACKGROUND:
        case SID_DISPLAY_MASTER_OBJECTS:
        {
            // Determine current page and toggle visibility of layers
            // associated with master page background or master page shapes.
            // FIXME: This solution is wrong, because shapes of master pages need
            // not be on layer "background" or "backgroundobjects".
            // See tdf#118613
            SdPage* pPage = GetActualPage();
            if (pPage != nullptr
                && GetDoc() != nullptr)
            {
                SdrLayerIDSet aVisibleLayers = pPage->TRG_GetMasterPageVisibleLayers();
                SdrLayerAdmin& rLayerAdmin = GetDoc()->GetLayerAdmin();
                SdrLayerID aLayerId;
                if (nSId == SID_DISPLAY_MASTER_BACKGROUND)
                    aLayerId = rLayerAdmin.GetLayerID(sUNO_LayerName_background);
                else
                    aLayerId = rLayerAdmin.GetLayerID(sUNO_LayerName_background_objects);
                aVisibleLayers.Set(aLayerId, !aVisibleLayers.IsSet(aLayerId));
                pPage->TRG_SetMasterPageVisibleLayers(aVisibleLayers);
            }
            Cancel();
            rReq.Done(); // Mark task as done to auto-update the state of each buttons tdf#132816
        }
        break;

        case SID_PHOTOALBUM:
        {
            SdAbstractDialogFactory* pFact = SdAbstractDialogFactory::Create();
            vcl::Window* pWin = GetActiveWindow();
            ScopedVclPtr<VclAbstractDialog> pDlg(pFact->CreateSdPhotoAlbumDialog(
                pWin ? pWin->GetFrameWeld() : nullptr,
                *GetDoc()));

            pDlg->Execute();
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_INSERT_QRCODE:
        case SID_EDIT_QRCODE:
        {
            VclAbstractDialogFactory* pFact = VclAbstractDialogFactory::Create();
            const uno::Reference<frame::XModel> xModel = GetViewShellBase().GetController()->getModel();
            VclPtr<AbstractQrCodeGenDialog> pDlg(pFact->CreateQrCodeGenDialog(
                GetFrameWeld(), xModel, rReq.GetSlot() == SID_EDIT_QRCODE));
            pDlg->StartExecuteAsync([pDlg](sal_Int32) {
                pDlg->disposeOnce();
            });
            Cancel();
            rReq.Ignore ();
        }
        break;

        case SID_THEME_DIALOG:
        {
            SdrPage* pMasterPage = &GetActualPage()->TRG_GetMasterPage();
            auto pTheme = pMasterPage->getSdrPageProperties().getTheme();
            auto pDialog = std::make_shared<svx::ThemeDialog>(GetFrameWeld(), pTheme.get());
            auto* pDocShell = GetDocSh();
            weld::DialogController::runAsync(pDialog, [pDialog, pMasterPage, pDocShell](sal_uInt32 nResult)
            {
                if (RET_OK != nResult)
                    return;

                auto pColorSet = pDialog->getCurrentColorSet();
                if (pColorSet)
                {
                    sd::ThemeColorChanger aChanger(pMasterPage, pDocShell);
                    aChanger.apply(pColorSet);
                }
            });

            Cancel();
            rReq.Ignore();
        }
        break;

        case SID_ADD_THEME:
        {
            // Create empty color set as starting point for new theme
            auto pCurrentColorSet = std::make_shared<model::ColorSet>(OUString());

            // Open ThemeColorEditDialog to create/edit the new color set
            auto pSubDialog = std::make_shared<svx::ThemeColorEditDialog>(GetFrameWeld(), *pCurrentColorSet);

            weld::DialogController::runAsync(pSubDialog, [pSubDialog](sal_uInt32 nResult) {
                if (nResult != RET_OK)
                    return;

                auto aColorSet = pSubDialog->getColorSet();
                if (!aColorSet.getName().isEmpty())
                {
                    // Add the new color set to the global collection
                    svx::ColorSets::get().insert(aColorSet);
                }
            });

            Cancel();
            rReq.Ignore();
        }
        break;

        case SID_APPLY_THEME:
        {
            const SfxItemSet* pArgs = rReq.GetArgs();
            if (pArgs)
            {
                const SfxPoolItem* pItem;
                if (pArgs->GetItemState(FN_PARAM_1, true, &pItem) == SfxItemState::SET)
                {
                    OUString aThemeName = static_cast<const SfxStringItem*>(pItem)->GetValue();
                    auto pColorSet = svx::ColorSets::get().getColorSet(aThemeName);

                    if (pColorSet)
                    {
                        SdrPage* pMasterPage = &GetActualPage()->TRG_GetMasterPage();
                        auto* pDocShell = GetDocSh();

                        auto pSharedColorSet = std::shared_ptr<model::ColorSet>(new model::ColorSet(*pColorSet));
                        sd::ThemeColorChanger aChanger(pMasterPage, pDocShell);
                        aChanger.apply(pSharedColorSet);
                    }
                }
            }

            Cancel();
            rReq.Done();
        }
        break;

        case SID_ATTR_GLOW_COLOR:
        case SID_ATTR_GLOW_RADIUS:
        case SID_ATTR_GLOW_TRANSPARENCY:
        case SID_ATTR_GLOW_TEXT_COLOR:
        case SID_ATTR_GLOW_TEXT_RADIUS:
        case SID_ATTR_GLOW_TEXT_TRANSPARENCY:
        case SID_ATTR_SOFTEDGE_RADIUS:
        case SID_ATTR_TEXTCOLUMNS_NUMBER:
        case SID_ATTR_TEXTCOLUMNS_SPACING:
        case SID_ATTR_TEXT_AUTOGROWWIDTH:
        case SID_ATTR_TEXT_AUTOGROWHEIGHT:
        case SID_ATTR_TEXT_LEFTDIST:
        case SID_ATTR_TEXT_RIGHTDIST:
        case SID_ATTR_TEXT_UPPERDIST:
        case SID_ATTR_TEXT_LOWERDIST:
            if (const SfxItemSet* pNewArgs = rReq.GetArgs())
                mpDrawView->SetAttributes(*pNewArgs);
            rReq.Done();
            Cancel();
            break;

        case SID_PASTE_SLIDE:
        case SID_COPY_SLIDE:
        {
            sd::slidesorter::SlideSorterViewShell::GetSlideSorter(GetViewShellBase())
                ->GetSlideSorter()
                .GetController()
                .FuSupport(rReq);
            Cancel();
            rReq.Done();
        }
        break;
        default:
        {
            SAL_WARN( "sd.ui", "Slot without function" );
            Cancel();
            rReq.Ignore ();
        }
        break;
    }

    if(HasCurrentFunction())
    {
        GetCurrentFunction()->Activate();
    }
}

void DrawViewShell::ExecChar( SfxRequest &rReq )
{
    SdDrawDocument* pDoc = GetDoc();
    if (!pDoc || !mpDrawView)
        return;

    SfxItemSet aEditAttr( pDoc->GetPool() );
    mpDrawView->GetAttributes( aEditAttr );

    //modified by wj for sym2_1580, if put old itemset into new set,
    //when mpDrawView->SetAttributes(aNewAttr) it will invalidate all the item
    // and use old attr to update all the attributes
//  SfxItemSet aNewAttr( GetPool(),
//  EE_ITEMS_START, EE_ITEMS_END );
//  aNewAttr.Put( aEditAttr, false );
    SfxItemSet aNewAttr( pDoc->GetPool() );
    //modified end

    sal_uInt16 nSId = rReq.GetSlot();

    switch ( nSId )
    {
    case SID_ATTR_CHAR_FONT:
        if( rReq.GetArgs() )
        {
            const SvxFontItem* pItem = rReq.GetArg(SID_ATTR_CHAR_FONT);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;
    case SID_ATTR_CHAR_FONTHEIGHT:
        if( rReq.GetArgs() )
        {
            const SvxFontHeightItem* pItem = rReq.GetArg(SID_ATTR_CHAR_FONTHEIGHT);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;
    case SID_ATTR_CHAR_WEIGHT:
        if( rReq.GetArgs() )
        {
            const SvxWeightItem* pItem = rReq.GetArg(SID_ATTR_CHAR_WEIGHT);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;
    case SID_ATTR_CHAR_POSTURE:
        if( rReq.GetArgs() )
        {
            const SvxPostureItem* pItem = rReq.GetArg(SID_ATTR_CHAR_POSTURE);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;
    case SID_ATTR_CHAR_UNDERLINE:
        if( rReq.GetArgs() )
        {
            const SvxUnderlineItem* pItem = rReq.GetArg(SID_ATTR_CHAR_UNDERLINE);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
            else
            {
                FontLineStyle eFU = aEditAttr.Get( EE_CHAR_UNDERLINE ).GetLineStyle();
                aNewAttr.Put( SvxUnderlineItem( eFU != LINESTYLE_NONE ?LINESTYLE_NONE : LINESTYLE_SINGLE,  EE_CHAR_UNDERLINE ) );
            }
        }
        break;
    case SID_ATTR_CHAR_OVERLINE:
        if( rReq.GetArgs() )
        {
            const SvxOverlineItem* pItem = rReq.GetArg(SID_ATTR_CHAR_OVERLINE);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
            else
            {
                FontLineStyle eFU = aEditAttr.Get( EE_CHAR_OVERLINE ).GetLineStyle();
                aNewAttr.Put( SvxOverlineItem( eFU != LINESTYLE_NONE ?LINESTYLE_NONE : LINESTYLE_SINGLE,  EE_CHAR_OVERLINE ) );
            }
        }
        break;

        case SID_ULINE_VAL_NONE:
        {
            aNewAttr.Put(SvxUnderlineItem(LINESTYLE_NONE, EE_CHAR_UNDERLINE));
            break;
        }

        case SID_ULINE_VAL_SINGLE:
        case SID_ULINE_VAL_DOUBLE:
        case SID_ULINE_VAL_DOTTED:
        {
            FontLineStyle eOld = aEditAttr.Get(EE_CHAR_UNDERLINE).GetLineStyle();
            FontLineStyle eNew = eOld;

            switch (nSId)
            {
                case SID_ULINE_VAL_SINGLE:
                    eNew = ( eOld == LINESTYLE_SINGLE ) ? LINESTYLE_NONE : LINESTYLE_SINGLE;
                    break;
                case SID_ULINE_VAL_DOUBLE:
                    eNew = ( eOld == LINESTYLE_DOUBLE ) ? LINESTYLE_NONE : LINESTYLE_DOUBLE;
                    break;
                case SID_ULINE_VAL_DOTTED:
                    eNew = ( eOld == LINESTYLE_DOTTED ) ? LINESTYLE_NONE : LINESTYLE_DOTTED;
                    break;
            }

            SvxUnderlineItem aUnderline(eNew, EE_CHAR_UNDERLINE);
            aNewAttr.Put(aUnderline);
        }
        break;

    case SID_ATTR_CHAR_SHADOWED:
        if( rReq.GetArgs() )
        {
            const SvxShadowedItem* pItem = rReq.GetArg(SID_ATTR_CHAR_SHADOWED);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;
    case SID_ATTR_CHAR_CONTOUR:
        if( rReq.GetArgs() )
        {
            const SvxContourItem* pItem = rReq.GetArg(SID_ATTR_CHAR_CONTOUR);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;

    case SID_ATTR_CHAR_STRIKEOUT:
        if( rReq.GetArgs() )
        {
            const SvxCrossedOutItem* pItem = rReq.GetArg(SID_ATTR_CHAR_STRIKEOUT);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;
    case SID_ATTR_CHAR_COLOR:
        if( rReq.GetArgs() )
        {
            const SvxColorItem* pItem = rReq.GetArg(SID_ATTR_CHAR_COLOR);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;
    case SID_ATTR_CHAR_KERNING:
        if( rReq.GetArgs() )
        {
            const SvxKerningItem* pItem = rReq.GetArg(SID_ATTR_CHAR_KERNING);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;
    case SID_ATTR_CHAR_CASEMAP:
        if( rReq.GetArgs() )
        {
            const SvxCaseMapItem* pItem = rReq.GetArg(SID_ATTR_CHAR_CASEMAP);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;
    case SID_SET_SMALL_CAPS:
        {
            SvxCaseMap eCaseMap = aEditAttr.Get(EE_CHAR_CASEMAP).GetCaseMap();
            if (eCaseMap == SvxCaseMap::SmallCaps)
                eCaseMap = SvxCaseMap::NotMapped;
            else
                eCaseMap = SvxCaseMap::SmallCaps;
            SvxCaseMapItem aItem(eCaseMap, EE_CHAR_CASEMAP);
            aNewAttr.Put(aItem);
        }
        break;
    case SID_SET_SUB_SCRIPT:
        {
            SvxEscapementItem aItem( EE_CHAR_ESCAPEMENT );
            SvxEscapement eEsc = aEditAttr.Get(EE_CHAR_ESCAPEMENT).GetEscapement();
            if( eEsc == SvxEscapement::Subscript )
                aItem.SetEscapement( SvxEscapement::Off );
            else
                aItem.SetEscapement( SvxEscapement::Subscript );
            aNewAttr.Put( aItem );
        }
        break;
    case SID_SET_SUPER_SCRIPT:
        {
            SvxEscapementItem aItem( EE_CHAR_ESCAPEMENT );
            SvxEscapement eEsc = aEditAttr.Get(EE_CHAR_ESCAPEMENT).GetEscapement();
            if( eEsc == SvxEscapement::Superscript )
                aItem.SetEscapement( SvxEscapement::Off );
            else
                aItem.SetEscapement( SvxEscapement::Superscript );
            aNewAttr.Put( aItem );
        }
        break;
    case SID_SHRINK_FONT_SIZE:
    case SID_GROW_FONT_SIZE:
        {
            const SvxFontListItem* pFonts = GetDocSh()->GetItem( SID_ATTR_CHAR_FONTLIST );
            const FontList* pFontList = pFonts ? pFonts->GetFontList() : nullptr;
            if( pFontList )
            {
                FuText::ChangeFontSize( nSId == SID_GROW_FONT_SIZE, nullptr, pFontList, mpView );
                GetViewFrame()->GetBindings().Invalidate( SID_ATTR_CHAR_FONTHEIGHT );
            }
            break;
        }
    case SID_ATTR_CHAR_BACK_COLOR:
        if( rReq.GetArgs() )
        {
            const SvxColorItem* pItem = rReq.GetArg<SvxColorItem>(SID_ATTR_CHAR_BACK_COLOR);
            if (pItem)
            {
                aNewAttr.Put(*pItem);
            }
        }
        break;
    default:
        break;
    }

    mpDrawView->SetAttributes(aNewAttr);
    rReq.Done();
    Cancel();
}

/** This method consists basically of three parts:
    1. Process the arguments of the SFX request.
    2. Use the model to create a new page or duplicate an existing one.
    3. Update the tab control and switch to the new page.
*/
SdPage* DrawViewShell::CreateOrDuplicatePage (
    SfxRequest& rRequest,
    PageKind ePageKind,
    SdPage* pPage,
    const sal_Int32 nInsertPosition)
{
    SdPage* pNewPage = nullptr;
    if (ePageKind == PageKind::Standard && meEditMode != EditMode::MasterPage)
    {
        if ( mpDrawView->IsTextEdit() )
        {
            mpDrawView->SdrEndTextEdit();
        }
        pNewPage = ViewShell::CreateOrDuplicatePage (rRequest, ePageKind, pPage, nInsertPosition);
    }
    return pNewPage;
}

void DrawViewShell::DuplicateSelectedSlides (SfxRequest& rRequest)
{
    ::sd::slidesorter::SlideSorterViewShell* pSlideSorterViewShell =
        sd::slidesorter::SlideSorterViewShell::GetSlideSorter(GetViewShellBase());
    if (!pSlideSorterViewShell)
        return;

    // Create a list of the pages that are to be duplicated.  The process of
    // duplication alters the selection.
    sal_Int32 nInsertPosition (0);
    ::std::vector<SdPage*> aPagesToDuplicate;
    sd::slidesorter::SlideSorter &rSlideSorter = pSlideSorterViewShell->GetSlideSorter();
    sd::slidesorter::model::PageEnumeration aSelectedPages (
        sd::slidesorter::model::PageEnumerationProvider::CreateSelectedPagesEnumeration(rSlideSorter.GetModel()));
    while (aSelectedPages.HasMoreElements())
    {
        sd::slidesorter::model::SharedPageDescriptor pDescriptor (aSelectedPages.GetNextElement());
        if (pDescriptor && pDescriptor->GetPage())
        {
            aPagesToDuplicate.push_back(pDescriptor->GetPage());
            nInsertPosition = pDescriptor->GetPage()->GetPageNum()+2;
        }
    }

    // Duplicate the pages in aPagesToDuplicate and collect the newly
    // created pages in aPagesToSelect.
    const bool bUndo (aPagesToDuplicate.size()>1 && rSlideSorter.GetView().IsUndoEnabled());
    if (bUndo)
        rSlideSorter.GetView().BegUndo(SdResId(STR_INSERTPAGE));

    ::std::vector<SdPage*> aPagesToSelect;
    for(::std::vector<SdPage*>::const_iterator
            iPage(aPagesToDuplicate.begin()),
            iEnd(aPagesToDuplicate.end());
        iPage!=iEnd;
        ++iPage, nInsertPosition+=2)
    {
        aPagesToSelect.push_back(
            rSlideSorter.GetViewShell().CreateOrDuplicatePage(
                rRequest, PageKind::Standard, *iPage, nInsertPosition));
    }
    aPagesToDuplicate.clear();

    if (bUndo)
        rSlideSorter.GetView().EndUndo();

    // Set the selection to the pages in aPagesToSelect.
    sd::slidesorter::controller::PageSelector& rSelector (rSlideSorter.GetController().GetPageSelector());
    rSelector.DeselectAllPages();
    for (auto const& it: aPagesToSelect)
    {
        rSelector.SelectPage(it);
    }
}

void DrawViewShell::ExecutePropPanelAttr (SfxRequest const & rReq)
{
    SdDrawDocument* pDoc = GetDoc();
    if (!pDoc || !mpDrawView)
        return;

    sal_uInt16 nSId = rReq.GetSlot();
    SfxItemSet aAttrs( pDoc->GetPool() );

    switch ( nSId )
    {
    case SID_TABLE_VERT_NONE:
    case SID_TABLE_VERT_CENTER:
    case SID_TABLE_VERT_BOTTOM:
        SdrTextVertAdjust eTVA = SDRTEXTVERTADJUST_TOP;
        if (nSId == SID_TABLE_VERT_CENTER)
            eTVA = SDRTEXTVERTADJUST_CENTER;
        else if (nSId == SID_TABLE_VERT_BOTTOM)
            eTVA = SDRTEXTVERTADJUST_BOTTOM;

        aAttrs.Put( SdrTextVertAdjustItem(eTVA) );
        mpDrawView->SetAttributes(aAttrs);

        break;
    }
}

void DrawViewShell::GetStatePropPanelAttr(SfxItemSet& rSet)
{
    SfxWhichIter    aIter( rSet );
    sal_uInt16          nWhich = aIter.FirstWhich();

    SdDrawDocument* pDoc = GetDoc();
    if (!pDoc || !mpDrawView)
        return;

    SfxItemSet aAttrs( pDoc->GetPool() );
    mpDrawView->GetAttributes( aAttrs );

    while ( nWhich )
    {
        sal_uInt16 nSlotId = SfxItemPool::IsWhich(nWhich)
            ? GetPool().GetSlotId(nWhich)
            : nWhich;
        switch ( nSlotId )
        {
            case SID_TABLE_VERT_NONE:
            case SID_TABLE_VERT_CENTER:
            case SID_TABLE_VERT_BOTTOM:
                bool bContour = false;
                SfxItemState eConState = aAttrs.GetItemState( SDRATTR_TEXT_CONTOURFRAME );
                if( eConState != SfxItemState::INVALID )
                {
                    bContour = aAttrs.Get( SDRATTR_TEXT_CONTOURFRAME ).GetValue();
                }
                if (bContour) break;

                SfxItemState eVState = aAttrs.GetItemState( SDRATTR_TEXT_VERTADJUST );
                //SfxItemState eHState = aAttrs.GetItemState( SDRATTR_TEXT_HORZADJUST );

                //if(SfxItemState::INVALID != eVState && SfxItemState::INVALID != eHState)
                if(SfxItemState::INVALID != eVState)
                {
                    SdrTextVertAdjust eTVA = aAttrs.Get(SDRATTR_TEXT_VERTADJUST).GetValue();
                    bool bSet = (nSlotId == SID_TABLE_VERT_NONE && eTVA == SDRTEXTVERTADJUST_TOP) ||
                            (nSlotId == SID_TABLE_VERT_CENTER && eTVA == SDRTEXTVERTADJUST_CENTER) ||
                            (nSlotId == SID_TABLE_VERT_BOTTOM && eTVA == SDRTEXTVERTADJUST_BOTTOM);
                    rSet.Put(SfxBoolItem(nSlotId, bSet));
                }
                else
                {
                    rSet.Put(SfxBoolItem(nSlotId, false));
                }
                break;
        }
        nWhich = aIter.NextWhich();
    }
}

} // end of namespace sd

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
