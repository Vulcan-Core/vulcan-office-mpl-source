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

#ifndef INCLUDED_SVX_SOURCE_SVDRAW_SVDPDF_HXX
#define INCLUDED_SVX_SOURCE_SVDRAW_SVDPDF_HXX

#include <sal/config.h>

#include <memory>
#include <map>

#include <tools/fract.hxx>
#include <vcl/virdev.hxx>
#include <vcl/graph.hxx>
#include <svx/svdobj.hxx>
#include <svx/xdash.hxx>

#include <basegfx/matrix/b2dhommatrix.hxx>
#include <basegfx/range/b2drectangle.hxx>
#include <vector>

#include <vcl/filter/PDFiumLibrary.hxx>

// Forward Declarations

class SfxItemSet;
class SdrObjList;
class SdrModel;
class SdrObject;
class SvdProgressInfo;

// Fonts are typically saved in pdf files as multiple subsets.
// This describes a single font subset:
struct FontSubSet
{
    // The location of a file containing the dumped info about the font
    OUString cidFontInfoUrl;
    // The location of a 'mergefile' derived from glyphToChars/charsToGlyph
    // that indicates what positions the glyphs of this font should go in
    // a final font merged from multiple subsets
    OUString toMergedMapUrl;
    // The location of the extracted font, converted to a cid font.
    OUString pfaCIDUrl;
    // What glyphs are in the subset and what characters those represent.
    std::map<sal_Int32, OString> glyphToChars;
    std::map<OString, sal_Int32> charsToGlyph;
    // What glyphs ranges are in the subset
    std::map<sal_Int32, Range> glyphRangesToChars;
    int nGlyphCount;
};

// The collection of all font subsets in the document.
struct SubSetInfo
{
    std::vector<FontSubSet> aComponents;
};

// Describes a final, possibly merged from multiple input fontsubsets,
// font of a given name and fontweight available as fontfile
struct EmbeddedFontInfo
{
    OUString sFontName;
    OUString sFontFile;
    FontWeight eFontWeight;
};

// Helper Class to import PDF
class ImpSdrPdfImport final
{
    std::vector<rtl::Reference<SdrObject>> maTmpList;

    ScopedVclPtr<VirtualDevice> mpVD;
    tools::Rectangle maScaleRect;
    size_t mnMapScalingOfs; // from here on, not edited with MapScaling
    std::unique_ptr<SfxItemSet> mpLineAttr;
    std::unique_ptr<SfxItemSet> mpFillAttr;
    std::unique_ptr<SfxItemSet> mpTextAttr;
    SdrModel* mpModel;
    std::shared_ptr<ImportedFontMap> mxImportedFonts;
    SdrLayerID mnLayer;
    sal_Int32 mnLineWidth;
    static constexpr css::drawing::LineCap gaLineCap = css::drawing::LineCap_BUTT;
    XDash maDash;
    std::optional<Color> moFillColor;
    std::optional<Bitmap> moFillPattern;

    bool mbMov;
    bool mbSize;
    Point maOfs;
    double mfScaleX;
    double mfScaleY;
    double maScaleX;
    double maScaleY;

    bool mbFntDirty;

    // to optimize (PenNULL,Brush,DrawPoly),(Pen,BrushNULL,DrawPoly) -> two-in-one
    bool mbLastObjWasPolyWithoutLine;
    bool mbNoLine;
    bool mbNoFill;

    std::unique_ptr<vcl::pdf::PDFiumDocument> mpPdfDocument;
    int mnPageCount;
    double mdPageHeightPts;
    /// Skip reconstructing the PDF's embedded fonts into OTFs (map each to its
    /// PostScript family name and let the container's font fall back instead).
    /// The reconstruction (CollectFonts -> convertToOTF -> makeotf) aborts the
    /// process on some embedded subsets — the ones our own draw_pdf_Export
    /// produces among them — so the interactive decompose skips it: an
    /// editable page wants a real font it can retype in, not a subset.
    bool mbSkipEmbeddedFonts;
    /// The current transformation matrix, typically used with Form objects.
    basegfx::B2DHomMatrix maCurrentMatrix;

    /// Correct the vertical coordinate to start at the top.
    /// PDF coordinate system has origin at the bottom right.
    double correctVertOrigin(double offsetPts) const { return mdPageHeightPts - offsetPts; }
    /// Convert PDF points to logic (twips).
    tools::Rectangle PointsToLogic(double left, double right, double top, double bottom) const;
    Point PointsToLogic(double x, double y) const;

    std::shared_ptr<vcl::pdf::PDFium> mpPDFium;

    Color getStrokeColor(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                         std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage);
    Color getFillColor(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                       std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage);

    void ImportPdfObject(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                         std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage,
                         std::unique_ptr<vcl::pdf::PDFiumTextPage> const& pTextPage,
                         int nPageObjectIndex);
    void ImportForm(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                    std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage,
                    std::unique_ptr<vcl::pdf::PDFiumTextPage> const& pTextPage,
                    int nPageObjectIndex);
    void ImportImage(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                     std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage,
                     int nPageObjectIndex);
    void ImportPath(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                    std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage, int nPageObjectIndex);
    void ImportText(std::unique_ptr<vcl::pdf::PDFiumPageObject> const& pPageObject,
                    std::unique_ptr<vcl::pdf::PDFiumPage> const& pPage,
                    std::unique_ptr<vcl::pdf::PDFiumTextPage> const& pTextPage,
                    int nPageObjectIndex);
    void InsertTextObject(const Point& rPos, const Size& rSize, const OUString& rStr,
                          bool bInvisible);

    /// One glyph of the page's text: code point and box in logic (1/100 mm,
    /// y down) coordinates, from pdfium's text page.
    struct PageChar
    {
        sal_uInt32 nCode;
        basegfx::B2DRectangle aBox;
    };
    std::vector<PageChar> maPageChars;
    std::vector<size_t> maPageNonSpace; ///< indices into maPageChars of the glyphs that are not spaces
    const vcl::pdf::PDFiumTextPage* mpPageCharsFor = nullptr;
    size_t mnPageRunCursor = 0; ///< index into maPageNonSpace where the next object's run is looked for first
    void collectPageChars(std::unique_ptr<vcl::pdf::PDFiumTextPage> const& pTextPage);
    /// Insert a pdfium text object as the runs a reader sees (see the
    /// definition). Returns false when the glyphs could not be matched to
    /// the text, in which case the caller inserts the object as one run.
    bool InsertTextSegments(const tools::Rectangle& rObjRect, const OUString& rText,
                            bool bInvisible);

    void SetupPageScale(const double dPageWidth, const double dPageHeight);
    void SetAttributes(SdrObject* pObj, bool bForceTextAttr = false);
    void InsertObj(SdrObject* pObj, bool bScale = true);
    void MapScaling();

    void appendSegmentsToPolyPoly(
        basegfx::B2DPolyPolygon& rPolyPoly,
        const std::vector<std::unique_ptr<vcl::pdf::PDFiumPathSegment>>& rPathSegments,
        const basegfx::B2DHomMatrix& rPathMatrix);

    basegfx::B2DPolyPolygon GetClip(const std::unique_ptr<vcl::pdf::PDFiumClipPath>& rClipPath,
                                    const basegfx::B2DHomMatrix& rPathMatrix,
                                    const basegfx::B2DHomMatrix& rTransform);

    // #i73407# reformulation to use new B2DPolygon classes
    bool CheckLastPolyLineAndFillMerge(const basegfx::B2DPolyPolygon& rPolyPolygon);

    void DoObjects(SvdProgressInfo* pProgrInfo, sal_uInt32* pActionsToReport, int nPageIndex);

    static ImportedFontMap CollectFonts(std::u16string_view sPrefix,
                                        vcl::pdf::PDFiumDocument& rPdfDocument, bool bSkipEmbeddedFonts);

    static EmbeddedFontInfo convertToOTF(std::u16string_view sPrefix, SubSetInfo& rSubSetInfo,
                                         const OUString& fileUrl, const OUString& fontName,
                                         const OUString& baseFontName,
                                         std::u16string_view fontFileName,
                                         const std::vector<uint8_t>& toUnicodeData,
                                         const vcl::pdf::PDFiumFont& font);

    // Copy assignment is forbidden and not implemented.
    ImpSdrPdfImport(const ImpSdrPdfImport&) = delete;
    ImpSdrPdfImport& operator=(const ImpSdrPdfImport&) = delete;

public:
    /// pSharedFonts: a family-name-only font map shared across the pages of
    /// one decompose (filled by the first page, reused by the rest) — the
    /// skip-fonts map is never cached on the GfxLink, so without it every
    /// page walked the whole document's text again (quadratic in pages).
    ImpSdrPdfImport(SdrModel& rModel, SdrLayerID nLay, const tools::Rectangle& rRect,
                    Graphic const& rGraphic, bool bSkipEmbeddedFonts = false,
                    std::shared_ptr<ImportedFontMap>* pSharedFonts = nullptr);

    ~ImpSdrPdfImport();

    int GetPageCount() const { return mnPageCount; }
    size_t DoImport(SdrObjList& rDestList, size_t nInsPos, int nPageNumber,
                    SvdProgressInfo* pProgrInfo = nullptr);
};

#endif // INCLUDED_SVX_SOURCE_SVDRAW_SVDPDF_HXX

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
