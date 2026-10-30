/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/*
 * This file is part of the Collabora Office project.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 */

#pragma once

#include <memory>
#include <stdint.h>
#include <utility>
#include <vector>

#include <com/sun/star/util/DateTime.hpp>

#include <vcl/dllapi.h>
#include <basegfx/vector/b2dsize.hxx>
#include <basegfx/range/b2drectangle.hxx>
#include <basegfx/point/b2dpoint.hxx>
#include <basegfx/matrix/b2dhommatrix.hxx>
#include <rtl/ustring.hxx>
#include <tools/color.hxx>
#include <tools/fontenum.hxx>
#include <tools/gen.hxx>
#include <vcl/checksum.hxx>
#include <vcl/Scanline.hxx>
#include <vcl/pdf/PDFAnnotationSubType.hxx>
#include <vcl/pdf/PDFPageObjectType.hxx>
#include <vcl/pdf/PDFSegmentType.hxx>
#include <vcl/pdf/PDFBitmapType.hxx>
#include <vcl/pdf/PDFObjectType.hxx>
#include <vcl/pdf/PDFTextRenderMode.hxx>
#include <vcl/pdf/PDFFillMode.hxx>
#include <vcl/pdf/PDFFindFlags.hxx>
#include <vcl/pdf/PDFErrorType.hxx>
#include <vcl/pdf/PDFFormFieldType.hxx>
#include <vcl/pdf/PDFAnnotAActionType.hxx>

class SvMemoryStream;
class Bitmap;

namespace vcl::pdf
{
inline constexpr OString constDictionaryKeyTitle = "T"_ostr;
inline constexpr OString constDictionaryKeyContents = "Contents"_ostr;
inline constexpr OString constDictionaryKeyPopup = "Popup"_ostr;
inline constexpr OString constDictionaryKeyModificationDate = "M"_ostr;
inline constexpr OString constDictionaryKeyInteriorColor = "IC"_ostr;
inline constexpr OString constDictionaryKey_DefaultStyle = "DS"_ostr;
inline constexpr OString constDictionaryKey_RichContent = "RC"_ostr;
// PDF markup-annotation keys: /IRT links a reply to its parent annotation;
// /RT says whether /IRT is a reply ("R", default) or a grouping ("Group");
// /State + /StateModel describe the annotation's review/marked state.
inline constexpr OString constDictionaryKey_InReplyTo = "IRT"_ostr;
inline constexpr OString constDictionaryKey_ReplyType = "RT"_ostr;
inline constexpr OString constDictionaryKey_State = "State"_ostr;
inline constexpr OString constDictionaryKey_StateModel = "StateModel"_ostr;

class PDFiumBitmap;
class PDFiumDocument;
class PDFiumPageObject;

// Description based on the table 8.104 Entries in the DocMDP transform parameters dictionary
//
// The enum type describes the access permissions
// granted for this document.
enum class MDPPermission : sal_uInt8
{
    Unspecified = 0,
    NoChangesAllowed = 1, // No changes to the document are permitted, invalidates the signature.
    FormFillAllowed = 2, // Permitted changes are filling in forms, instantiating page templates,
    // and signing; other changes invalidate the signature.
    AnnotationsAllowed = 3 // Permitted changes are the same as for 2,
    // as well as annotation creation, deletion, and modification; other changes invalidate the signature.
};

inline MDPPermission MDPPermissionFromInt(int v) noexcept
{
    switch (v)
    {
        case 1:
            return MDPPermission::NoChangesAllowed;
        case 2:
            return MDPPermission::FormFillAllowed;
        case 3:
            return MDPPermission::AnnotationsAllowed;
        default:
            return MDPPermission::Unspecified;
    }
}

class PDFiumFont
{
public:
    virtual ~PDFiumFont() = default;

    virtual bool getFontData(std::vector<uint8_t>& rData) const = 0;
    virtual bool getFontToUnicode(std::vector<uint8_t>& rData) const = 0;
    virtual bool getIsEmbedded() const = 0;

    // Get the index in the font of the glyph represented by the pdf "character
    // code" of nCharCode. Which itself is what is mapped to unicode by a pdf's
    // ToUnicode resource.
    // A return of 0 represents not-found.
    virtual sal_uInt32 getGlyphIndexFromCharCode(const sal_uInt32 nCharCode) const = 0;

    virtual sal_Int32 getFontDictObjNum() const = 0;
};

class VCL_DLLPUBLIC PDFium
{
public:
    virtual ~PDFium() = default;

    virtual const OUString& getLastError() const = 0;

    virtual std::unique_ptr<PDFiumDocument> openDocument(const void* pData, int nSize,
                                                         const OString& rPassword)
        = 0;
    virtual PDFErrorType getLastErrorCode() = 0;
    /// createBitmap can reduce requested size to possible value
    virtual std::unique_ptr<PDFiumBitmap> createBitmap(int& nWidth, int& nHeight, int nAlpha) = 0;
};

class PDFiumPage;

class VCL_DLLPUBLIC PDFiumBitmap
{
public:
    virtual ~PDFiumBitmap() = default;
    virtual void fillRect(int left, int top, int width, int height, sal_uInt32 nColor) = 0;
    virtual void renderPageBitmap(PDFiumDocument* pDoc, PDFiumPage* pPage, int nStartX, int nStartY,
                                  int nSizeX, int nSizeY)
        = 0;
    /// Only the page's AcroForm widgets (their appearance streams), drawn over
    /// what the bitmap already holds; same placement as renderPageBitmap,
    /// turned by nRotate quarter turns clockwise (FPDF_FFLDraw's rotate).
    virtual void renderFormFields(PDFiumDocument* pDoc, PDFiumPage* pPage, int nStartX, int nStartY,
                                  int nSizeX, int nSizeY, int nRotate)
        = 0;
    virtual ConstScanline getBuffer() = 0;
    virtual int getStride() = 0;
    virtual int getWidth() = 0;
    virtual int getHeight() = 0;
    virtual PDFBitmapType getFormat() = 0;
    /// Convert the bitmap buffer to a Bitmap
    virtual Bitmap createBitmapFromBuffer() = 0;
};

class VCL_DLLPUBLIC PDFiumAnnotation
{
public:
    virtual ~PDFiumAnnotation() = default;
    virtual PDFAnnotationSubType getSubType() = 0;
    virtual basegfx::B2DRectangle getRectangle() = 0;
    /// Value of the /F (annotation flags) entry; 0 if absent.
    virtual int getFlags() = 0;
    virtual bool hasKey(OString const& rKey) = 0;
    virtual PDFObjectType getValueType(OString const& rKey) = 0;
    virtual OUString getString(OString const& rKey) = 0;
    virtual std::unique_ptr<PDFiumAnnotation> getLinked(OString const& rKey) = 0;
    virtual int getObjectCount() = 0;
    virtual std::unique_ptr<PDFiumPageObject> getObject(int nIndex) = 0;
    virtual std::vector<std::vector<basegfx::B2DPoint>> getInkStrokes() = 0;
    virtual std::vector<basegfx::B2DPoint> getVertices() = 0;
    virtual Color getColor() = 0;
    virtual Color getInteriorColor() = 0;
    virtual float getBorderWidth() = 0;
    virtual basegfx::B2DSize getBorderCornerRadius() = 0;
    virtual size_t getAttachmentPointsCount() = 0;
    virtual std::vector<basegfx::B2DPoint> getAttachmentPoints(size_t nIndex) = 0;
    virtual std::vector<basegfx::B2DPoint> getLineGeometry() = 0;
    virtual PDFFormFieldType getFormFieldType(PDFiumDocument* pDoc) = 0;
    virtual float getFontSize(PDFiumDocument* pDoc) = 0;
    virtual Color getFontColor(PDFiumDocument* pDoc) = 0;
    virtual OUString getFormFieldAlternateName(PDFiumDocument* pDoc) = 0;
    virtual int getFormFieldFlags(PDFiumDocument* pDoc) = 0;
    virtual OUString getFormAdditionalActionJavaScript(PDFiumDocument* pDoc,
                                                       PDFAnnotAActionType eEvent)
        = 0;
    virtual OUString getFormFieldValue(PDFiumDocument* pDoc) = 0;
    /// The fully-qualified AcroForm field name (/T chain), e.g. "company_name".
    virtual OUString getFormFieldName(PDFiumDocument* pDoc) = 0;
    virtual int getOptionCount(PDFiumDocument* pDoc) = 0;
    /// The display label of a combo / list box option.
    virtual OUString getOptionLabel(PDFiumDocument* pDoc, int nIndex) = 0;
    /// Whether a combo / list box option is selected.
    virtual bool isOptionSelected(PDFiumDocument* pDoc, int nIndex) = 0;
    /// Whether a check box or radio button widget is on.
    virtual bool isChecked(PDFiumDocument* pDoc) = 0;
    /// The export value of a check box or radio button widget: the name of
    /// its "on" appearance state (e.g. "Yes", or a radio option's value).
    virtual OUString getFormFieldExportValue(PDFiumDocument* pDoc) = 0;
    /// A number entry of the annotation's own dictionary (e.g. "MaxLen");
    /// false when absent.
    virtual bool getNumberValue(OString const& rKey, float& rValue) = 0;
};

/// An image's colour space family; the values are pdfium's FPDF_COLORSPACE_*.
enum class PDFImageColorSpace
{
    Unknown = 0,
    DeviceGray = 1,
    DeviceRGB = 2,
    DeviceCMYK = 3,
    CalGray = 4,
    CalRGB = 5,
    Lab = 6,
    ICCBased = 7,
    Separation = 8,
    DeviceN = 9,
    Indexed = 10,
    Pattern = 11,
};

class VCL_DLLPUBLIC PDFiumLink
{
public:
    virtual ~PDFiumLink() = default;
    virtual basegfx::B2DRectangle getRectangle() = 0;
    virtual OUString getURIPath() = 0;
};

class PDFiumTextPage;

class VCL_DLLPUBLIC PDFiumPathSegment
{
public:
    virtual ~PDFiumPathSegment() = default;
    virtual basegfx::B2DPoint getPoint() const = 0;
    virtual bool isClosed() const = 0;
    virtual PDFSegmentType getType() const = 0;
};

class VCL_DLLPUBLIC PDFiumClipPath
{
public:
    virtual ~PDFiumClipPath() = default;

    virtual int getPathCount() = 0;
    virtual int getPathSegmentCount(int nPathIndex) = 0;
    virtual std::unique_ptr<PDFiumPathSegment> getPathSegment(int nPathIndex, int nSegmentIndex)
        = 0;
};

class VCL_DLLPUBLIC PDFiumPageObject
{
public:
    virtual ~PDFiumPageObject() = default;

    virtual PDFPageObjectType getType() = 0;
    /// The pdfium handle, for matching against PDFiumTextPage::getTextObjectPointer().
    virtual void* getPointer() = 0;
    virtual OUString getText(std::unique_ptr<PDFiumTextPage> const& pTextPage) = 0;

    virtual int getFormObjectCount() = 0;
    virtual std::unique_ptr<PDFiumPageObject> getFormObject(int nIndex) = 0;

    virtual basegfx::B2DHomMatrix getMatrix() = 0;
    virtual basegfx::B2DRectangle getBounds() = 0;
    virtual double getFontSize() = 0;
    virtual OUString getFontName() = 0;
    virtual OUString getBaseFontName() = 0;
    virtual int getFontAngle() = 0;
    virtual std::unique_ptr<PDFiumFont> getFont() = 0;
    virtual PDFTextRenderMode getTextRenderMode() = 0;
    virtual Color getFillColor() = 0;
    virtual std::unique_ptr<PDFiumBitmap> getRenderedFillPattern(PDFiumDocument& rDoc,
                                                                 PDFiumPage& rPage)
        = 0;
    virtual Color getStrokeColor() = 0;
    virtual double getStrokeWidth() = 0;
    virtual std::unique_ptr<PDFiumBitmap> getRenderedStrokePattern(PDFiumDocument& rDoc,
                                                                   PDFiumPage& rPage)
        = 0;
    // Path
    virtual int getPathSegmentCount() = 0;
    virtual std::unique_ptr<PDFiumPathSegment> getPathSegment(int index) = 0;
    virtual Size getImageSize(PDFiumPage& rPage) = 0;
    virtual std::unique_ptr<PDFiumBitmap> getImageBitmap() = 0;
    /// The image as drawn: soft mask (transparency), colour key and decode
    /// applied, BGRA. getImageBitmap() is the bare sample data, which for a
    /// masked JPEG logo is the picture on a black field. Sized by the
    /// object's matrix (page points), so scale the matrix up first for the
    /// source's own resolution.
    virtual std::unique_ptr<PDFiumBitmap> getRenderedImage(PDFiumDocument& rDoc, PDFiumPage& rPage)
        = 0;
    /// The image stream's /Filter chain in the order it is applied (e.g.
    /// "DCTDecode"); empty when the stream is not filtered.
    virtual std::vector<OString> getImageFilters() = 0;
    /// The image stream as stored in the file, no filter applied: for a lone
    /// DCTDecode filter, the JPEG file itself. Empty on failure.
    virtual std::vector<sal_uInt8> getImageDataRaw() = 0;
    /// The image's colour space family, as pdfium reads it on rPage.
    virtual PDFImageColorSpace getImageColorSpace(PDFiumPage& rPage) = 0;
    /// The image's bits per pixel as pdfium reads it on rPage: 1 for a
    /// bilevel image (CCITT, JBIG2, a 1-bit Flate stream, a stencil mask);
    /// 0 on failure.
    virtual int getImageBitsPerPixel(PDFiumPage& rPage) = 0;
    /// The content marks the object is drawn inside (BDC ... EMC), as
    /// pdfium lists them, outermost first: each mark's name, and the string
    /// value of rParamKey in the mark's property dictionary (empty when the
    /// mark has none). The innermost mark is the last entry.
    virtual std::vector<std::pair<OUString, OUString>> getMarks(const OString& rParamKey) = 0;
    virtual void setMatrix(const basegfx::B2DHomMatrix& rMatrix) = 0;
    virtual bool getDrawMode(PDFFillMode& eFillMode, bool& bStroke) = 0;

    // ClipPath
    virtual std::unique_ptr<PDFiumClipPath> getClipPath() = 0;
};

class VCL_DLLPUBLIC PDFiumSearchHandle
{
public:
    virtual ~PDFiumSearchHandle() = default;

    virtual bool findNext() = 0;
    virtual bool findPrev() = 0;
    virtual int getSearchResultIndex() = 0;
    virtual int getSearchCount() = 0;
};

class VCL_DLLPUBLIC PDFiumTextPage
{
public:
    virtual ~PDFiumTextPage() = default;

    virtual int countChars() = 0;
    virtual unsigned int getUnicode(int index) = 0;
    virtual std::unique_ptr<PDFiumSearchHandle>
    findStart(const OUString& rFindWhat, PDFFindFlags nFlags, sal_Int32 nStartIndex) = 0;

    /// Returned rect is no longer upside down and is in mm100.
    virtual basegfx::B2DRectangle getCharBox(int nIndex, double fPageHeight) = 0;
    /// The page object that drew the char (compare with PDFiumPageObject::getPointer());
    /// null for a char pdfium generated (a space from a gap).
    virtual void* getTextObjectPointer(int nIndex) = 0;
    /// The char's origin on its baseline, in PDF points (y up).
    virtual bool getCharOrigin(int nIndex, double& rX, double& rY) = 0;
    /// The char's advance box (bearings included), in PDF points (y up).
    virtual bool getLooseCharBox(int nIndex, double& rLeft, double& rRight, double& rBottom,
                                 double& rTop) = 0;
};

class VCL_DLLPUBLIC PDFiumStructureElement
{
public:
    virtual ~PDFiumStructureElement() = default;

    virtual OUString getAltText() = 0;
    virtual OUString getActualText() = 0;
    virtual OUString getID() = 0;
    virtual OUString getLang() = 0;
    virtual OUString getTitle() = 0;
    virtual OUString getType() = 0;
    virtual OUString getObjectType() = 0;

    virtual int getNumberOfChildren() = 0;
    virtual int getChildMarkedContentID(int nIndex) = 0;
    virtual std::unique_ptr<PDFiumStructureElement> getChild(int nIndex) = 0;
    virtual std::unique_ptr<PDFiumStructureElement> getParent() = 0;
};

class VCL_DLLPUBLIC PDFiumStructureTree
{
public:
    virtual ~PDFiumStructureTree() = default;

    virtual int getNumberOfChildren() = 0;
    virtual std::unique_ptr<PDFiumStructureElement> getChild(int nIndex) = 0;
};

class VCL_DLLPUBLIC PDFiumPage
{
public:
    virtual ~PDFiumPage() = default;

    virtual int getObjectCount() = 0;
    virtual std::unique_ptr<PDFiumPageObject> getObject(int nIndex) = 0;

    virtual int getAnnotationCount() = 0;
    virtual int getAnnotationIndex(std::unique_ptr<PDFiumAnnotation> const& rAnnotation) = 0;

    virtual std::unique_ptr<PDFiumAnnotation> getAnnotation(int nIndex) = 0;

    virtual std::unique_ptr<PDFiumTextPage> getTextPage() = 0;
    virtual std::unique_ptr<PDFiumStructureTree> getStructureTree() = 0;

    /// Get bitmap checksum of the page, without annotations/commenting.
    virtual BitmapChecksum getChecksum(MDPPermission nMDPPerm) = 0;

    virtual double getWidth() = 0;
    virtual double getHeight() = 0;

    /// The page's /Rotate in quarter turns clockwise (0-3); -1 on error.
    virtual int getRotation() = 0;
    /// pdfium's page-to-device mapping for a render at nStartX/nStartY,
    /// nSizeX x nSizeY, turned nRotate quarter turns: the mapping
    /// renderPageBitmap and renderFormFields draw with (CropBox origin and
    /// /Rotate applied). False when pdfium cannot map the point.
    virtual bool pageToDevice(int nStartX, int nStartY, int nSizeX, int nSizeY, int nRotate,
                              double fPageX, double fPageY, int& rDeviceX, int& rDeviceY)
        = 0;

    virtual bool hasTransparency() = 0;

    virtual bool hasLinks() = 0;
    virtual std::unique_ptr<PDFiumLink> enumerateLink(int* nStartIndex, PDFiumDocument* pDoc) = 0;

    virtual void onAfterLoadPage(PDFiumDocument* pDoc) = 0;
};

/// Represents one digital signature, as exposed by PDFium.
class VCL_DLLPUBLIC PDFiumSignature
{
public:
    virtual ~PDFiumSignature() = default;

    virtual std::vector<int> getByteRange() = 0;
    virtual MDPPermission getDocMDPPermission() = 0;
    virtual std::vector<unsigned char> getContents() = 0;
    virtual OString getSubFilter() = 0;
    virtual OUString getReason() = 0;
    virtual css::util::DateTime getTime() = 0;
};

class VCL_DLLPUBLIC PDFiumAttachment
{
public:
    virtual ~PDFiumAttachment() = default;

    virtual OUString getName() = 0;
    virtual bool getFile(std::vector<unsigned char>& rOutBuffer) = 0;
};

class VCL_DLLPUBLIC PDFiumDocument
{
public:
    virtual ~PDFiumDocument() = default;

    // Page size in points
    virtual basegfx::B2DSize getPageSize(int nIndex) = 0;
    virtual int getPageCount() = 0;
    virtual int getSignatureCount() = 0;
    virtual int getFileVersion() = 0;
    virtual int getAttachmentCount() = 0;
    virtual bool saveWithVersion(SvMemoryStream& rStream, int nFileVersion, bool bRemoveSecurity)
        = 0;

    virtual std::unique_ptr<PDFiumPage> openPage(int nIndex) = 0;
    virtual std::unique_ptr<PDFiumSignature> getSignature(int nIndex) = 0;
    virtual std::unique_ptr<PDFiumAttachment> getAttachment(int nIndex) = 0;

    virtual std::vector<unsigned int> getTrailerEnds() = 0;
    virtual OUString getBookmarks() = 0;
};

struct VCL_DLLPUBLIC PDFiumLibrary final
{
    static std::shared_ptr<PDFium>& get();
};

// Tools

VCL_DLLPUBLIC OUString convertPdfDateToISO8601(std::u16string_view rInput);

} // namespace vcl::pdf

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
