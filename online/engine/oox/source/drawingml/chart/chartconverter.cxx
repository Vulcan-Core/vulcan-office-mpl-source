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

#include <com/sun/star/beans/PropertyValue.hpp>
#include <com/sun/star/beans/XPropertySet.hpp>
#include <com/sun/star/chart2/XAnyDescriptionAccess.hpp>
#include <com/sun/star/chart2/XChartDocument.hpp>
#include <com/sun/star/chart2/data/XDataReceiver.hpp>
#include <com/sun/star/frame/XModel.hpp>
#include <com/sun/star/io/XInputStream.hpp>
#include <com/sun/star/util/XNumberFormatsSupplier.hpp>
#include <comphelper/diagnose_ex.hxx>
#include <comphelper/propertyvalue.hxx>
#include <comphelper/sequenceashashmap.hxx>
#include <drawingml/chart/chartworkbook.hxx>
#include <drawingml/chart/chartspaceconverter.hxx>
#include <drawingml/chart/chartspacemodel.hxx>
#include <drawingml/chart/stylemodel.hxx>
#include <drawingml/chart/colorsmodel.hxx>
#include <docmodel/uno/UnoChartStyle.hxx>
#include <docmodel/uno/UnoChartColorStyle.hxx>
#include <docmodel/styles/ChartStyle.hxx>
#include <docmodel/styles/ChartColorStyle.hxx>
#include <oox/helper/containerhelper.hxx>
#include <oox/core/xmlfilterbase.hxx>
#include <osl/diagnose.h>
#include <rtl/ustrbuf.hxx>

#include <utility>

#include <oox/drawingml/chart/chartconverter.hxx>

using ::oox::drawingml::chart::DataSequenceModel;
using ::cpo::uno::Any;
namespace oox::drawingml::chart {

using namespace ::com::sun::star;
using namespace ::com::sun::star::chart2;
using namespace ::com::sun::star::chart2::data;
using namespace ::com::sun::star::drawing;
using namespace ::com::sun::star::uno;
using namespace cpo::uno;

using ::oox::core::XmlFilterBase;

const sal_Unicode API_TOKEN_ARRAY_OPEN      = '{';
const sal_Unicode API_TOKEN_ARRAY_CLOSE     = '}';
const sal_Unicode API_TOKEN_ARRAY_COLSEP    = ';';

static OUString lclGenerateApiArray(const std::vector<Any>& rRow, sal_Int32 nStart, sal_Int32 nCount)
{
    OSL_ENSURE( !rRow.empty(), "ChartConverter::lclGenerateApiArray - missing matrix values" );
    OUStringBuffer aBuffer(( OUStringChar(API_TOKEN_ARRAY_OPEN) ));
    for (auto aBeg = rRow.begin() + nStart, aIt = aBeg, aEnd = aBeg + nCount; aIt != aEnd; ++aIt)
    {
        double fValue = 0.0;
        OUString aString;
        if( aIt != aBeg )
            aBuffer.append( API_TOKEN_ARRAY_COLSEP );
        if( *aIt >>= fValue )
            aBuffer.append( fValue );
        else if( *aIt >>= aString )
        {
            // Code similar to sc/source/filter/oox/formulabase.cxx
            aBuffer.append( "\"" + aString.replaceAll(u"\"", u"\"\"") + "\"" );
        }
        else
            aBuffer.append( "\"\"" );
    }
    aBuffer.append( API_TOKEN_ARRAY_CLOSE );
    return aBuffer.makeStringAndClear();
}

ChartConverter::ChartConverter()
{
}

ChartConverter::~ChartConverter()
{
}

void ChartConverter::convertFromModel( XmlFilterBase& rFilter,
        ChartSpaceModel& rChartModel, const Reference< XChartDocument >& rxChartDoc,
        const Reference< XShapes >& rxExternalPage, const awt::Point& rChartPos,
        const awt::Size& rChartSize ) const
{
    OSL_ENSURE( rxChartDoc.is(), "ChartConverter::convertFromModel - missing chart document" );
    if( rxChartDoc.is() )
    {
        Reference< data::XDataReceiver > xDataReceiver( rxChartDoc, uno::UNO_QUERY_THROW );
        Reference< util::XNumberFormatsSupplier > xNumberFormatsSupplier( rFilter.getModel(), uno::UNO_QUERY );
        if (xNumberFormatsSupplier.is())
            xDataReceiver->attachNumberFormatsSupplier( xNumberFormatsSupplier );

        ConverterRoot aConvBase( rFilter, *this, rChartModel, rxChartDoc, rChartSize );
        ChartSpaceConverter aSpaceConv( aConvBase, rChartModel );
        aSpaceConv.convertFromModel( rxExternalPage, rChartPos );
    }
}

void ChartConverter::createDataProvider( const Reference< XChartDocument >&
        rxChartDoc ) const
{
    try
    {
        if( !rxChartDoc->hasInternalDataProvider() )
            rxChartDoc->createInternalDataProvider( false );
    }
    catch( Exception& )
    {
    }
}

Reference< XDataSequence > ChartConverter::createDataSequence(
    const Reference< XDataProvider >& rxDataProvider, const DataSequenceModel& rDataSeq,
    const OUString& rRole, const OUString& rRoleQualifier ) const
{
    Reference< XDataSequence > xDataSeq;
    if( rxDataProvider.is() )
    {
        OUString aRangeRep;
        if( !rDataSeq.maData.empty() || (rRole == "values-y" && rDataSeq.mnPointCount > 0) ) try
        {
            // create a single-row array from constant source data
            // (multiple levels in the case of complex categories)
            assert( rDataSeq.mnPointCount > 0);
            std::vector<Any> aRow(rDataSeq.mnLevelCount * rDataSeq.mnPointCount);
            for (auto const& elem : rDataSeq.maData)
                aRow.at(elem.first) = elem.second;

            for (sal_Int32 i = rDataSeq.mnLevelCount-1; i >= 0; i--)
            {
                aRangeRep = lclGenerateApiArray( aRow, i * rDataSeq.mnPointCount, rDataSeq.mnPointCount);

                if (!aRangeRep.isEmpty())
                {
                    // create or add a new level to the data sequence
                    xDataSeq = rxDataProvider->createDataSequenceByValueArray(rRole, aRangeRep, rRoleQualifier);
                    if (i == 0)
                        return xDataSeq;
                }
            }
        }
        catch( Exception& )
        {
            OSL_FAIL( "ChartConverter::createDataSequence - cannot create data sequence" );
        }
    }

    return nullptr;
}

// ===========
// ChartStyleConverter
// ===========
void ChartStyleConverter::convertFromModel(const XmlFilterBase& rFilter,
        const StyleModel& rChartStyleModel,
        const Reference< XChartStyle >& rxChartStyle)
{
    OSL_ENSURE( rxChartStyle.is(), "ChartStyleConverter::convertFromModel - missing chart style" );
    if (!rxChartStyle.is()) return;

    UnoChartStyle *pUnoCS = static_cast<UnoChartStyle*>(rxChartStyle.get());
    assert(pUnoCS);

    model::StyleSet& aStyles = pUnoCS->getChartStyle();

    if (rChartStyleModel.mxAxisTitle) {
        aStyles.addEntry(model::StyleSet::StyleEntryType::AXISTITLE,
                rChartStyleModel.mxAxisTitle->toStyleEntry(rFilter));
    }
    // etc.
    // TODO: fill in all the stuff

    aStyles.mnId = rChartStyleModel.mnId;
}

// ===========
// ChartColorStyleConverter
// ===========
void ChartColorStyleConverter::convertFromModel([[maybe_unused]] XmlFilterBase& rFilter,
        ColorStyleModel& rChartColorStyleModel,
        const Reference< XChartColorStyle >& rxChartColorStyle)
{
    OSL_ENSURE( rxChartColorStyle.is(), "ChartColorStyleConverter::convertFromModel - missing chart colorstyle" );
    if (!rxChartColorStyle.is()) return;

    UnoChartColorStyle *pUnoCS = static_cast<UnoChartColorStyle*>(rxChartColorStyle.get());
    assert(pUnoCS);

    model::ColorStyleSet& aColorStyles = pUnoCS->getChartColorStyle();

    if (!rChartColorStyleModel.maComplexColors.empty()) {
        aColorStyles.addEntry(rChartColorStyleModel.maComplexColors,
                rChartColorStyleModel.meMethod, rChartColorStyleModel.mnId);
    }
}

// ===========
// The workbook behind a PPTX chart's data (chartworkbook.hxx)
// ===========
namespace
{
constexpr OUString gaGrabBag = u"InteropGrabBag"_ustr;
constexpr OUString gaWorkbooks = u"OOXChartWorkbooks"_ustr;

/// The data a chart shows, as one string that changes when the data does: every value, and the
/// category and series names with all their levels.
OUString lclGetChartDataFingerprint(const Reference<XChartDocument>& rxChartDoc)
{
    if (!rxChartDoc.is() || !rxChartDoc->hasInternalDataProvider())
        return OUString();
    Reference<XAnyDescriptionAccess> xData(rxChartDoc->getDataProvider(), UNO_QUERY);
    if (!xData.is())
        return OUString();

    OUStringBuffer aBuffer;
    for (const Sequence<double>& rRow : xData->getData())
    {
        aBuffer.append("\n");
        for (const double fValue : rRow)
            aBuffer.append(OUString::number(fValue) + " ");
    }
    for (const Sequence<Sequence<OUString>>& rDescriptions :
         { xData->getComplexRowDescriptions(), xData->getComplexColumnDescriptions() })
    {
        aBuffer.append("\n");
        for (const Sequence<OUString>& rLevels : rDescriptions)
        {
            aBuffer.append("[");
            for (const OUString& rText : rLevels)
                aBuffer.append(OUString::number(rText.getLength()) + ":" + rText);
            aBuffer.append("]");
        }
    }
    return aBuffer.makeStringAndClear();
}
}

void keepChartWorkbook(XmlFilterBase& rFilter, const OUString& rPath,
                       const Reference<XChartDocument>& rxChartDoc)
{
    try
    {
        Reference<beans::XPropertySet> xDocProps(rFilter.getModel(), UNO_QUERY);
        if (rPath.isEmpty() || !xDocProps.is()
            || !xDocProps->getPropertySetInfo()->hasPropertyByName(gaGrabBag))
            return;

        comphelper::SequenceAsHashMap aGrabBag(xDocProps->getPropertyValue(gaGrabBag));
        comphelper::SequenceAsHashMap aWorkbooks(aGrabBag.getUnpackedValueOrDefault(
            gaWorkbooks, Sequence<beans::PropertyValue>()));
        if (aWorkbooks.contains(rPath))
            return;

        Reference<css::io::XInputStream> xStream = rFilter.openInputStream(rPath);
        Sequence<sal_Int8> aBytes;
        if (!xStream.is() || xStream->readBytes(aBytes, SAL_MAX_INT32) <= 0)
            return;
        // The part's own content type, when the package stream reports it.
        OUString aMediaType;
        Reference<beans::XPropertySet> xStreamProps(xStream, UNO_QUERY);
        if (xStreamProps.is())
        {
            try
            {
                xStreamProps->getPropertyValue(u"MediaType"_ustr) >>= aMediaType;
            }
            catch (const beans::UnknownPropertyException&)
            {
            }
        }

        aWorkbooks[rPath] <<= Sequence<beans::PropertyValue>{
            comphelper::makePropertyValue(u"Workbook"_ustr, aBytes),
            comphelper::makePropertyValue(u"MediaType"_ustr, aMediaType),
            comphelper::makePropertyValue(u"Data"_ustr, lclGetChartDataFingerprint(rxChartDoc))
        };
        aGrabBag[gaWorkbooks] <<= aWorkbooks.getAsConstPropertyValueList();
        xDocProps->setPropertyValue(gaGrabBag, Any(aGrabBag.getAsConstPropertyValueList()));
    }
    catch (const Exception&)
    {
        TOOLS_WARN_EXCEPTION("oox", "keepChartWorkbook: cannot keep " << rPath);
    }
}

bool getUnchangedChartWorkbook(XmlFilterBase& rFilter, const OUString& rPath,
                               const Reference<XChartDocument>& rxChartDoc,
                               Sequence<sal_Int8>& rBytes, OUString& rMediaType)
{
    try
    {
        Reference<beans::XPropertySet> xDocProps(rFilter.getModel(), UNO_QUERY);
        if (rPath.isEmpty() || !xDocProps.is()
            || !xDocProps->getPropertySetInfo()->hasPropertyByName(gaGrabBag))
            return false;

        const comphelper::SequenceAsHashMap aGrabBag(xDocProps->getPropertyValue(gaGrabBag));
        const comphelper::SequenceAsHashMap aWorkbooks(aGrabBag.getUnpackedValueOrDefault(
            gaWorkbooks, Sequence<beans::PropertyValue>()));
        const comphelper::SequenceAsHashMap aWorkbook(
            aWorkbooks.getUnpackedValueOrDefault(rPath, Sequence<beans::PropertyValue>()));
        const OUString aData = aWorkbook.getUnpackedValueOrDefault(u"Data"_ustr, OUString());
        Sequence<sal_Int8> aBytes
            = aWorkbook.getUnpackedValueOrDefault(u"Workbook"_ustr, Sequence<sal_Int8>());
        if (aData.isEmpty() || !aBytes.hasElements()
            || aData != lclGetChartDataFingerprint(rxChartDoc))
            return false;

        rBytes = std::move(aBytes);
        rMediaType = aWorkbook.getUnpackedValueOrDefault(u"MediaType"_ustr, OUString());
        // The part's type by its extension, as DocxExport::WriteEmbeddings guesses it.
        if (rMediaType.isEmpty() && rPath.endsWithIgnoreAsciiCase(".xlsm"))
            rMediaType = u"application/vnd.ms-excel.sheet.macroEnabled.12"_ustr;
        else if (rMediaType.isEmpty() && rPath.endsWithIgnoreAsciiCase(".bin"))
            rMediaType = u"application/vnd.openxmlformats-officedocument.oleObject"_ustr;
        else if (rMediaType.isEmpty())
            rMediaType = u"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"_ustr;
        return true;
    }
    catch (const Exception&)
    {
        TOOLS_WARN_EXCEPTION("oox", "getUnchangedChartWorkbook: cannot read " << rPath);
        return false;
    }
}


} // namespace oox::drawingml::chart

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
