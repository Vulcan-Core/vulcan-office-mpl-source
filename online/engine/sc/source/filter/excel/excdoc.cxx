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

#include <sfx2/objsh.hxx>
#include <rtl/ustring.hxx>

#include <document.hxx>
#include <docsh.hxx>
#include <scextopt.hxx>
#include <docoptio.hxx>
#include <tabprotection.hxx>
#include <postit.hxx>
#include <root.hxx>
#include <connectionsbuffer.hxx>
#include <connectionsfragment.hxx>

#include <excdoc.hxx>
#include <xeextlst.hxx>
#include <biffhelper.hxx>

#include <xcl97rec.hxx>
#include <xetable.hxx>
#include <xelink.hxx>
#include <xepage.hxx>
#include <xeview.hxx>
#include <xecontent.hxx>
#include <xeescher.hxx>
#include <xepivot.hxx>
#include <export/SparklineExt.hxx>
#include <XclExpChangeTrack.hxx>
#include <xepivotxml.hxx>
#include <xedbdata.hxx>
#include <export/NamedSheetViews.hxx>
#include <xlcontent.hxx>
#include <xlname.hxx>
#include <xllink.hxx>
#include <xltools.hxx>

#include <com/sun/star/container/XNameContainer.hpp>
#include <com/sun/star/document/XDocumentPropertiesSupplier.hpp>
#include <com/sun/star/frame/XModel.hpp>
#include <com/sun/star/script/ModuleType.hpp>
#include <com/sun/star/script/XLibraryContainer.hpp>
#include <com/sun/star/script/XStorageBasedLibraryContainer.hpp>
#include <com/sun/star/script/vba/XVBACompatibility.hpp>
#include <com/sun/star/script/vba/XVBAModuleInfo.hpp>
#include <global.hxx>
#include <unotools/charclass.hxx>
#include <map>
#include <set>
#include <utility>
#include <vector>
#include <o3tl/safeint.hxx>
#include <oox/helper/attributelist.hxx>
#include <oox/token/tokens.hxx>
#include <oox/token/namespaces.hxx>
#include <oox/token/relationship.hxx>
#include <oox/export/ThemeExport.hxx>
#include <docmodel/theme/Theme.hxx>
#include <svx/svdpage.hxx>
#include <memory>

using namespace oox;

static OUString lcl_GetVbaTabName( SCTAB n )
{
    OUString aRet = "__VBA__"  + OUString::number( static_cast<sal_uInt16>(n) );
    return aRet;
}

static void lcl_AddBookviews( XclExpRecordList<>& aRecList, const ExcTable& self )
{
    aRecList.AppendNewRecord( new XclExpXmlStartElementRecord( XML_bookViews ) );
    aRecList.AppendNewRecord( new XclExpWindow1( self.GetRoot() ) );
    aRecList.AppendNewRecord( new XclExpXmlEndElementRecord( XML_bookViews ) );
}

namespace {

/** workbookPr/@codeName. A record of its own so it lands inside <workbookPr …/>, between
    XclExpXmlStartSingleElementRecord and XclExpXmlEndSingleElementRecord, like Exc1904's date1904. */
class XclExpXmlWorkbookCodeName : public XclExpRecordBase
{
public:
    explicit XclExpXmlWorkbookCodeName( OUString aCodeName ) : maCodeName( std::move( aCodeName ) ) {}
    virtual void SaveXml( XclExpXmlStream& rStrm ) override { rStrm.WriteAttributes( XML_codeName, maCodeName ); }
private:
    OUString maCodeName;
};

/** A name VBA accepts for a module: a letter, then letters, digits or '_', at most 31 characters. Letters are not
    only ASCII: localized Excel names its sheets' modules in the UI language (Лист1). Drops a sheet whose code name is
    still its tab name ("My Data", a sheet appended outside VBA mode). */
bool lcl_IsVbaCodeName( const OUString& rName )
{
    if( rName.isEmpty() || rName.getLength() > 31 )
        return false;
    const CharClass& rCharClass = ScGlobal::getCharClass();
    for( sal_Int32 i = 0; i < rName.getLength(); ++i )
        if( !rCharClass.isLetter( rName, i ) && ( i == 0 || ( !rCharClass.isDigit( rName, i ) && rName[ i ] != '_' ) ) )
            return false;
    return true;
}

/** The module info of the document's Basic project when it is in VBA mode, else null. ScDocument::IsInVBAMode is
    not SC_DLLPUBLIC, so scfilt asks the Basic container itself. */
css::uno::Reference< css::script::vba::XVBAModuleInfo > lcl_GetVbaModuleInfo( const XclExpRoot& rRoot )
{
    try
    {
        ScDocShell* pShell = rRoot.GetDocShell();
        if( !pShell )
            return nullptr;
        css::uno::Reference< css::script::XLibraryContainer > xLibs = pShell->GetBasicContainer();
        css::uno::Reference< css::script::vba::XVBACompatibility > xVba( xLibs, css::uno::UNO_QUERY );
        if( !xVba.is() || !xVba->getVBACompatibilityMode() )
            return nullptr;
        OUString aLibName = xVba->getProjectName();   // the Basic library the VBA import filled (oox VbaProject)
        if( aLibName.isEmpty() || !xLibs->hasByName( aLibName ) )
            aLibName = u"Standard"_ustr;
        css::uno::Reference< css::container::XNameContainer > xLib;
        if( xLibs->hasByName( aLibName ) )
        {
            cpo::uno::Any aLibAny = xLibs->getByName( aLibName );
            aLibAny >>= xLib;
        }
        return css::uno::Reference< css::script::vba::XVBAModuleInfo >( xLib, css::uno::UNO_QUERY );
    }
    catch( const css::uno::Exception& )
    {
    }
    return nullptr;
}

/** sheetPr/@codeName per Calc sheet, empty = none; also the BIFF CODENAME records when lcl_UseLiveBiffCodeNames. Only
    for a document in VBA mode or with a workbook code name (a workbook made in Calc without VBA gets none, as before).
    A sheet's live code name is written when it is a VBA name, when in VBA mode Basic has a DOCUMENT module of that
    name, and when no other exported sheet and not the workbook carries it (case-insensitive; on a clash none of the
    sharers is written). */
std::vector< OUString > lcl_GetXmlSheetCodeNames( const XclExpRoot& rRoot )
{
    const ScDocument& rDoc = rRoot.GetDoc();
    const XclExpTabInfo& rTabInfo = rRoot.GetTabInfo();
    const SCTAB nCount = rTabInfo.GetScTabCount();
    std::vector< OUString > aNames( nCount );
    css::uno::Reference< css::script::vba::XVBAModuleInfo > xModuleInfo = lcl_GetVbaModuleInfo( rRoot );
    if( !xModuleInfo.is() && rDoc.GetCodeName().isEmpty() )
        return aNames;
    std::map< OUString, sal_Int32 > aUses;   // upper case code name -> number of carriers
    if( lcl_IsVbaCodeName( rDoc.GetCodeName() ) )
        ++aUses[ rDoc.GetCodeName().toAsciiUpperCase() ];
    for( SCTAB nTab = 0; nTab < nCount; ++nTab )
    {
        OUString aName;
        if( !rTabInfo.IsExportTab( nTab ) || !rDoc.GetCodeName( nTab, aName ) || !lcl_IsVbaCodeName( aName ) )
            continue;
        try
        {
            if( xModuleInfo.is() && ( !xModuleInfo->hasModuleInfo( aName )
                    || xModuleInfo->getModuleInfo( aName ).ModuleType != css::script::ModuleType::DOCUMENT ) )
                continue;
        }
        catch( const css::uno::Exception& )
        {
            continue;
        }
        aNames[ nTab ] = aName;
        ++aUses[ aName.toAsciiUpperCase() ];
    }
    for( OUString& rName : aNames )
        if( !rName.isEmpty() && aUses[ rName.toAsciiUpperCase() ] > 1 )
            rName.clear();
    return aNames;
}

/** The BIFF export writes the CODENAME records from the code names the .xls import kept (ScExtDocOptions,
    lcl_GetListedBiffCodeNames). A project kept from an .xlsx/.xlsm import comes without them (only the .xls import
    fills that list): its records then come from the live code names, by the .xlsx rules above. */
bool lcl_UseLiveBiffCodeNames( const XclExpRoot& rRoot )
{
    const ScExtDocOptions& rExtDocOpt = rRoot.GetExtDocOptions();
    return rRoot.HasVbaStorage() && rExtDocOpt.GetCodeNameCount() == 0
        && rExtDocOpt.GetDocSettings().maGlobCodeName.isEmpty();
}

/** The BIFF CODENAME records of a document whose .xls import kept a code name list (ScExtDocOptions), per Calc sheet
    (rSheetNames, empty = none) and for the empty __VBA__N sheets the export appends while that list is longer than the
    exported sheets (rPadNames, in order). The list is in the import's sheet order: written by position, each sheet
    after one deleted, inserted or moved in the editor took a neighbour's code name, and in Excel it would run that
    neighbour's Worksheet_* event code. Each sheet now gets its own code name (ScTable: the import set it from the same
    record, and it moves with the sheet) when the list holds that name, so only names of the project the export writes
    back are written. A sheet whose code name the list does not hold (one added in the editor) gets none, as before.
    As in lcl_GetXmlSheetCodeNames, a name two exported sheets carry (case-insensitive) is written for neither: in VBA
    mode VBA_InsertModule never reuses a name, but outside it a new sheet's code name is its tab name. The appended
    sheets take the listed names no sheet was given, in list order, so the module of a deleted sheet stays bound to one
    of them, as the list's last names were before; the number of appended sheets is unchanged. */
void lcl_GetListedBiffCodeNames( const XclExpRoot& rRoot, std::vector< OUString >& rSheetNames,
        std::vector< OUString >& rPadNames )
{
    const ScDocument& rDoc = rRoot.GetDoc();
    const XclExpTabInfo& rTabInfo = rRoot.GetTabInfo();
    const ScExtDocOptions& rExtDocOpt = rRoot.GetExtDocOptions();
    const SCTAB nCount = rTabInfo.GetScTabCount();
    const SCTAB nListed = rExtDocOpt.GetCodeNameCount();
    rSheetNames.assign( static_cast< size_t >( nCount ), OUString() );
    rPadNames.clear();
    std::set< OUString > aListed, aWritten;   // upper case
    for( SCTAB nIdx = 0; nIdx < nListed; ++nIdx )
        aListed.insert( rExtDocOpt.GetCodeName( nIdx ).toAsciiUpperCase() );
    std::map< OUString, sal_Int32 > aUses;   // upper case listed code name -> number of exported sheets carrying it
    for( SCTAB nTab = 0; nTab < nCount; ++nTab )
    {
        OUString aName;
        if( !rTabInfo.IsExportTab( nTab ) || !rDoc.GetCodeName( nTab, aName ) || aName.isEmpty()
                || aListed.find( aName.toAsciiUpperCase() ) == aListed.end() )
            continue;
        rSheetNames[ nTab ] = aName;
        ++aUses[ aName.toAsciiUpperCase() ];
    }
    for( OUString& rName : rSheetNames )
    {
        if( rName.isEmpty() )
            continue;
        if( aUses[ rName.toAsciiUpperCase() ] > 1 )
            rName.clear();
        else
            aWritten.insert( rName.toAsciiUpperCase() );
    }
    for( SCTAB nIdx = 0; nIdx < nListed; ++nIdx )
    {
        const OUString aName = rExtDocOpt.GetCodeName( nIdx );
        if( !aName.isEmpty() && aWritten.insert( aName.toAsciiUpperCase() ).second )
            rPadNames.push_back( aName );
    }
}

} // namespace

static void lcl_AddCalcPr( XclExpRecordList<>& aRecList, const ExcTable& self )
{
    ScDocument& rDoc = self.GetDoc();

    aRecList.AppendNewRecord( new XclExpXmlStartSingleElementRecord( XML_calcPr ) );
    // OOXTODO: calcCompleted, calcId, calcMode, calcOnSave,
    //          concurrentCalc, concurrentManualCount,
    //          forceFullCalc, fullCalcOnLoad, fullPrecision
    aRecList.AppendNewRecord( new XclCalccount( rDoc ) );
    aRecList.AppendNewRecord( new XclRefmode( rDoc ) );
    aRecList.AppendNewRecord( new XclIteration( rDoc ) );
    aRecList.AppendNewRecord( new XclDelta( rDoc ) );
    aRecList.AppendNewRecord( new XclExpBoolRecord(oox::xls::BIFF_ID_SAVERECALC, true) );
    aRecList.AppendNewRecord( new XclExpXmlEndSingleElementRecord() );  // XML_calcPr
}

static void lcl_AddWorkbookProtection( XclExpRecordList<>& aRecList, const ExcTable& self )
{
    aRecList.AppendNewRecord( new XclExpXmlStartSingleElementRecord( XML_workbookProtection ) );

    const ScDocProtection* pProtect = self.GetDoc().GetDocProtection();
    if (pProtect && pProtect->isProtected())
    {
        aRecList.AppendNewRecord( new XclExpWindowProtection(pProtect->isOptionEnabled(ScDocProtection::WINDOWS)) );
        aRecList.AppendNewRecord( new XclExpProtection(pProtect->isOptionEnabled(ScDocProtection::STRUCTURE)) );
        aRecList.AppendNewRecord( new XclExpPassHash(pProtect->getPasswordHash(PASSHASH_XL)) );
    }

    aRecList.AppendNewRecord( new XclExpXmlEndSingleElementRecord() );   // XML_workbookProtection
}

static void lcl_AddScenariosAndFilters( XclExpRecordList<>& aRecList, const XclExpRoot& rRoot, SCTAB nScTab )
{
    // Scenarios
    aRecList.AppendNewRecord( new ExcEScenarioManager( rRoot, nScTab ) );
    // filter
    aRecList.AppendRecord( rRoot.GetFilterManager().CreateRecord( nScTab ) );
}

ExcTable::ExcTable( const XclExpRoot& rRoot ) :
    XclExpRoot( rRoot ),
    mnScTab( SCTAB_GLOBAL ),
    nExcTab( EXC_NOTAB ),
    mxNoteList( new XclExpNoteList )
{
}

ExcTable::ExcTable( const XclExpRoot& rRoot, SCTAB nScTab ) :
    XclExpRoot( rRoot ),
    mnScTab( nScTab ),
    nExcTab( rRoot.GetTabInfo().GetXclTab( nScTab ) ),
    mxNoteList( new XclExpNoteList )
{
}

ExcTable::~ExcTable()
{
}

void ExcTable::Add( XclExpRecordBase* pRec )
{
    OSL_ENSURE( pRec, "-ExcTable::Add(): pRec is NULL!" );
    aRecList.AppendNewRecord( pRec );
}

void ExcTable::FillAsHeaderBinary( ExcBoundsheetList& rBoundsheetList )
{
    InitializeGlobals();

    RootData& rR = GetOldRoot();
    ScDocument& rDoc = GetDoc();
    XclExpTabInfo& rTabInfo = GetTabInfo();

    if ( GetBiff() <= EXC_BIFF5 )
        Add( new ExcBofW );
    else
        Add( new ExcBofW8 );

    sal_uInt16  nExcTabCount    = rTabInfo.GetXclTabCount();
    sal_uInt16  nCodenames      = static_cast< sal_uInt16 >( GetExtDocOptions().GetCodeNameCount() );

    ScDocShell* pShell = GetDocShell();
    sal_uInt16 nWriteProtHash = pShell ? pShell->GetModifyPasswordHash() : 0;
    bool bRecommendReadOnly = pShell && pShell->IsLoadReadonly();

    if( (nWriteProtHash > 0) || bRecommendReadOnly )
        Add( new XclExpEmptyRecord( EXC_ID_WRITEPROT ) );

    // TODO: correct codepage for BIFF5?
    sal_uInt16 nCodePage = XclTools::GetXclCodePage( (GetBiff() <= EXC_BIFF5) ? RTL_TEXTENCODING_MS_1252 : RTL_TEXTENCODING_UNICODE );

    if( GetBiff() <= EXC_BIFF5 )
    {
        Add( new XclExpEmptyRecord( EXC_ID_INTERFACEHDR ) );
        Add( new XclExpUInt16Record( EXC_ID_MMS, 0 ) );
        Add( new XclExpEmptyRecord( EXC_ID_TOOLBARHDR ) );
        Add( new XclExpEmptyRecord( EXC_ID_TOOLBAREND ) );
        Add( new XclExpEmptyRecord( EXC_ID_INTERFACEEND ) );
        Add( new ExcDummy_00 );
    }
    else
    {
        if( IsDocumentEncrypted() )
            Add( new XclExpFileEncryption( GetRoot() ) );
        Add( new XclExpInterfaceHdr( nCodePage ) );
        Add( new XclExpUInt16Record( EXC_ID_MMS, 0 ) );
        Add( new XclExpInterfaceEnd );
        Add( new XclExpWriteAccess );
    }

    Add( new XclExpFileSharing( GetRoot(), nWriteProtHash, bRecommendReadOnly ) );
    Add( new XclExpUInt16Record( EXC_ID_CODEPAGE, nCodePage ) );

    if( GetBiff() == EXC_BIFF8 )
    {
        Add( new XclExpBoolRecord( EXC_ID_DSF, false ) );
        Add( new XclExpEmptyRecord( EXC_ID_XL9FILE ) );
        rR.pTabId = new XclExpChTrTabId( std::max( nExcTabCount, nCodenames ) );
        Add( rR.pTabId );
        if( HasVbaStorage() )
        {
            Add( new XclObproj );
            const OUString& rCodeName = GetExtDocOptions().GetDocSettings().maGlobCodeName;
            if( !rCodeName.isEmpty() )
                Add( new XclCodename( rCodeName ) );
            else if( lcl_UseLiveBiffCodeNames( GetRoot() ) && lcl_IsVbaCodeName( rDoc.GetCodeName() ) )
                Add( new XclCodename( rDoc.GetCodeName() ) );
        }
    }

    Add( new XclExpUInt16Record( EXC_ID_FNGROUPCOUNT, 14 ) );

    if ( GetBiff() <= EXC_BIFF5 )
    {
        // global link table: EXTERNCOUNT, EXTERNSHEET, NAME
        aRecList.AppendRecord( CreateRecord( EXC_ID_EXTERNSHEET ) );
        aRecList.AppendRecord( CreateRecord( EXC_ID_NAME ) );
    }

    // document protection options
    lcl_AddWorkbookProtection( aRecList, *this );

    if( GetBiff() == EXC_BIFF8 )
    {
        Add( new XclExpProt4Rev );
        Add( new XclExpProt4RevPass );
    }

    lcl_AddBookviews( aRecList, *this );

    Add( new XclExpXmlStartSingleElementRecord( XML_workbookPr ) );
    if ( GetBiff() == EXC_BIFF8 && GetOutput() != EXC_OUTPUT_BINARY )
    {
        Add( new XclExpBoolRecord(0x0040, false, XML_backupFile ) );    // BACKUP
        Add( new XclExpBoolRecord(0x008D, false, XML_showObjects ) );   // HIDEOBJ
    }

    if ( GetBiff() == EXC_BIFF8 )
    {
        Add( new XclExpBoolRecord(0x0040, false) ); // BACKUP
        Add( new XclExpBoolRecord(0x008D, false) ); // HIDEOBJ
    }

    if( GetBiff() <= EXC_BIFF5 )
    {
        Add( new ExcDummy_040 );
        Add( new Exc1904( rDoc ) );
        Add( new ExcDummy_041 );
    }
    else
    {
        // BIFF8
        Add( new Exc1904( rDoc ) );
        Add( new XclExpBoolRecord( 0x000E, !rDoc.GetDocOptions().IsCalcAsShown() ) );
        Add( new XclExpBoolRecord(0x01B7, false) ); // REFRESHALL
        Add( new XclExpBoolRecord(0x00DA, false) ); // BOOKBOOL
    }

    // Formatting: FONT, FORMAT, XF, STYLE, PALETTE
    aRecList.AppendRecord( CreateRecord( EXC_ID_FONTLIST ) );
    aRecList.AppendRecord( CreateRecord( EXC_ID_FORMATLIST ) );
    aRecList.AppendRecord( CreateRecord( EXC_ID_XFLIST ) );
    aRecList.AppendRecord( CreateRecord( EXC_ID_PALETTE ) );

    SCTAB   nC;
    SCTAB  nScTabCount     = rTabInfo.GetScTabCount();
    if( GetBiff() <= EXC_BIFF5 )
    {
        // Bundlesheet
        for( nC = 0 ; nC < nScTabCount ; nC++ )
            if( rTabInfo.IsExportTab( nC ) )
            {
                ExcBoundsheetList::RecordRefType xBoundsheet = new ExcBundlesheet( rR, nC );
                aRecList.AppendRecord( xBoundsheet );
                rBoundsheetList.AppendRecord( xBoundsheet );
            }
    }
    else
    {
        // Pivot Cache
        GetPivotTableManager().CreatePivotTables();
        aRecList.AppendRecord( GetPivotTableManager().CreatePivotCachesRecord() );

        // Change tracking
        if( rDoc.GetChangeTrack() )
        {
            rR.pUserBViewList = new XclExpUserBViewList( *rDoc.GetChangeTrack() );
            Add( rR.pUserBViewList );
        }

        // Natural Language Formulas Flag
        aRecList.AppendNewRecord( new XclExpBoolRecord( EXC_ID_USESELFS, GetDoc().GetDocOptions().IsLookUpColRowNames() ) );

        // Bundlesheet
        for( nC = 0 ; nC < nScTabCount ; nC++ )
            if( rTabInfo.IsExportTab( nC ) )
            {
                ExcBoundsheetList::RecordRefType xBoundsheet = new ExcBundlesheet8( rR, nC );
                aRecList.AppendRecord( xBoundsheet );
                rBoundsheetList.AppendRecord( xBoundsheet );
            }

        OUString aTmpString;
        for( SCTAB nAdd = 0; nC < static_cast<SCTAB>(nCodenames) ; nC++, nAdd++ )
        {
            aTmpString = lcl_GetVbaTabName( nAdd );
            ExcBoundsheetList::RecordRefType xBoundsheet = new ExcBundlesheet8( aTmpString );
            aRecList.AppendRecord( xBoundsheet );
            rBoundsheetList.AppendRecord( xBoundsheet );
        }

        // COUNTRY - in BIFF8 in workbook globals
        Add( new XclExpCountry( GetRoot() ) );

        // link table: SUPBOOK, XCT, CRN, EXTERNNAME, EXTERNSHEET, NAME
        aRecList.AppendRecord( CreateRecord( EXC_ID_EXTERNSHEET ) );
        aRecList.AppendRecord( CreateRecord( EXC_ID_NAME ) );

        Add( new XclExpRecalcId );

        // MSODRAWINGGROUP per-document data
        aRecList.AppendRecord( GetObjectManager().CreateDrawingGroup() );
        // Shared string table: SST, EXTSST
        aRecList.AppendRecord( CreateRecord( EXC_ID_SST ) );

        Add( new XclExpBookExt );
    }

    Add( new ExcEof );
}

void ExcTable::FillAsHeaderXml( ExcBoundsheetList& rBoundsheetList )
{
    InitializeGlobals();

    RootData& rR = GetOldRoot();
    ScDocument& rDoc = GetDoc();
    XclExpTabInfo& rTabInfo = GetTabInfo();

    sal_uInt16  nExcTabCount    = rTabInfo.GetXclTabCount();
    sal_uInt16  nCodenames      = static_cast< sal_uInt16 >( GetExtDocOptions().GetCodeNameCount() );

    rR.pTabId = new XclExpChTrTabId( std::max( nExcTabCount, nCodenames ) );
    Add( rR.pTabId );

    Add( new XclExpXmlStartSingleElementRecord( XML_workbookPr ) );
    Add( new XclExpBoolRecord(0x0040, false, XML_backupFile ) );    // BACKUP
    Add( new XclExpBoolRecord(0x008D, false, XML_showObjects ) );   // HIDEOBJ

    Add( new Exc1904( rDoc ) );
    if( lcl_IsVbaCodeName( rDoc.GetCodeName() ) )
        Add( new XclExpXmlWorkbookCodeName( rDoc.GetCodeName() ) );
    // OOXTODO: The following /workbook/workbookPr attributes are mapped
    //          to various BIFF records that are not currently supported:
    //
    //          XML_allowRefreshQuery:          QSISTAG 802h: fEnableRefresh
    //          XML_autoCompressPictures:       COMPRESSPICTURES 89Bh: fAutoCompressPictures
    //          XML_checkCompatibility:         COMPAT12 88Ch: fNoCompatChk
    //          XML_defaultThemeVersion:        ???
    //          XML_filterPrivacy:              BOOKEXT 863h: fFilterPrivacy
    //          XML_hidePivotFieldList:         BOOKBOOL DAh: fHidePivotTableFList
    //          XML_promptedSolutions:          BOOKEXT 863h: fBuggedUserAboutSolution
    //          XML_publishItems:               NAMEPUBLISH 893h: fPublished
    //          XML_saveExternalLinkValues:     BOOKBOOL DAh: fNoSavSupp
    //          XML_showBorderUnselectedTables: BOOKBOOL DAh: fHideBorderUnsels
    //          XML_showInkAnnotation:          BOOKEXT 863h: fShowInkAnnotation
    //          XML_showPivotChart:             PIVOTCHARTBITS 859h: fGXHide??
    //          XML_updateLinks:                BOOKBOOL DAh: grbitUpdateLinks
    Add( new XclExpXmlEndSingleElementRecord() );   // XML_workbookPr

    // Formatting: FONT, FORMAT, XF, STYLE, PALETTE
    aRecList.AppendNewRecord( new XclExpXmlStyleSheet( *this ) );

    // Change tracking
    if( rDoc.GetChangeTrack() )
    {
        rR.pUserBViewList = new XclExpUserBViewList( *rDoc.GetChangeTrack() );
        Add( rR.pUserBViewList );
    }

    lcl_AddWorkbookProtection( aRecList, *this );
    lcl_AddBookviews( aRecList, *this );

    // Bundlesheet
    SCTAB nC;
    SCTAB nScTabCount = rTabInfo.GetScTabCount();
    aRecList.AppendNewRecord( new XclExpXmlStartElementRecord( XML_sheets ) );
    for( nC = 0 ; nC < nScTabCount ; nC++ )
        if( rTabInfo.IsExportTab( nC ) )
        {
            ExcBoundsheetList::RecordRefType xBoundsheet = new ExcBundlesheet8( rR, nC );
            aRecList.AppendRecord( xBoundsheet );
            rBoundsheetList.AppendRecord( xBoundsheet );
        }
    aRecList.AppendNewRecord( new XclExpXmlEndElementRecord( XML_sheets ) );

    OUString aTmpString;
    for( SCTAB nAdd = 0; nC < static_cast<SCTAB>(nCodenames) ; nC++, nAdd++ )
    {
        aTmpString = lcl_GetVbaTabName( nAdd );
        ExcBoundsheetList::RecordRefType xBoundsheet = new ExcBundlesheet8( aTmpString );
        aRecList.AppendRecord( xBoundsheet );
        rBoundsheetList.AppendRecord( xBoundsheet );
    }

    // link table: SUPBOOK, XCT, CRN, EXTERNNAME, EXTERNSHEET, NAME
    aRecList.AppendRecord( CreateRecord( EXC_ID_EXTERNSHEET ) );
    aRecList.AppendRecord( CreateRecord( EXC_ID_NAME ) );

    lcl_AddCalcPr( aRecList, *this );

    // MSODRAWINGGROUP per-document data
    aRecList.AppendRecord( GetObjectManager().CreateDrawingGroup() );
    // Shared string table: SST, EXTSST
    aRecList.AppendRecord( CreateRecord( EXC_ID_SST ) );
}

void ExcTable::FillAsTableBinary( const OUString& rCodeName )
{
    InitializeTable( mnScTab );

    RootData& rR = GetOldRoot();
    XclBiff eBiff = GetBiff();
    ScDocument& rDoc = GetDoc();

    OSL_ENSURE( (mnScTab >= 0) && (mnScTab <= MAXTAB), "-ExcTable::Table(): mnScTab - no ordinary table!" );
    OSL_ENSURE( nExcTab <= o3tl::make_unsigned(MAXTAB), "-ExcTable::Table(): nExcTab - no ordinary table!" );

    // create a new OBJ list for this sheet (may be used by notes, autofilter, data validation)
    if( eBiff == EXC_BIFF8 )
        GetObjectManager().StartSheet();

    // cell table: DEFROWHEIGHT, DEFCOLWIDTH, COLINFO, DIMENSIONS, ROW, cell records
    mxCellTable = new XclExpCellTable( GetRoot() );

    //export cell notes
    std::vector<sc::NoteEntry> aNotes;
    rDoc.GetAllNoteEntries(aNotes);
    for (const auto& rNote : aNotes)
    {
        if (rNote.maPos.Tab() != mnScTab)
            continue;

        mxNoteList->AppendNewRecord(new XclExpNote(GetRoot(), rNote.maPos, rNote.mpNote, u""));
    }

    // WSBOOL needs data from page settings, create it here, add it later
    rtl::Reference<XclExpPageSettings> xPageSett = new XclExpPageSettings( GetRoot() );
    bool bFitToPages = xPageSett->GetPageData().mbFitToPages;

    if( eBiff <= EXC_BIFF5 )
    {
        Add( new ExcBof );
        Add( new ExcDummy_02a );
    }
    else
    {
        Add( new ExcBof8 );
        lcl_AddCalcPr( aRecList, *this );
    }

    // GUTS (count & size of outline icons)
    aRecList.AppendRecord( mxCellTable->CreateRecord( EXC_ID_GUTS ) );
    // DEFROWHEIGHT, created by the cell table
    aRecList.AppendRecord( mxCellTable->CreateRecord( EXC_ID2_DEFROWHEIGHT ) );

    // COUNTRY - in BIFF5/7 in every worksheet
    if( eBiff <= EXC_BIFF5 )
        Add( new XclExpCountry( GetRoot() ) );

    Add( new XclExpWsbool( bFitToPages ) );

    // page settings (SETUP and various other records)
    aRecList.AppendRecord( xPageSett );

    const ScTableProtection* pTabProtect = rDoc.GetTabProtection(mnScTab);
    if (pTabProtect && pTabProtect->isProtected())
    {
        Add( new XclExpProtection(true) );
        Add( new XclExpBoolRecord(oox::xls::BIFF_ID_SCENPROTECT, pTabProtect->isOptionEnabled(ScTableProtection::SCENARIOS)) );
        if (pTabProtect->isOptionEnabled(ScTableProtection::OBJECTS))
            Add( new XclExpBoolRecord(oox::xls::BIFF_ID_OBJECTPROTECT, true ));
        Add( new XclExpPassHash(pTabProtect->getPasswordHash(PASSHASH_XL)) );
    }

    // local link table: EXTERNCOUNT, EXTERNSHEET
    if( eBiff <= EXC_BIFF5 )
        aRecList.AppendRecord( CreateRecord( EXC_ID_EXTERNSHEET ) );

    if ( eBiff == EXC_BIFF8 )
        lcl_AddScenariosAndFilters( aRecList, GetRoot(), mnScTab );

    // cell table: DEFCOLWIDTH, COLINFO, DIMENSIONS, ROW, cell records
    aRecList.AppendRecord( mxCellTable );

    // MERGEDCELLS record, generated by the cell table
    aRecList.AppendRecord( mxCellTable->CreateRecord( EXC_ID_MERGEDCELLS ) );
    // label ranges
    if( eBiff == EXC_BIFF8 )
        Add( new XclExpLabelranges( GetRoot() ) );
    // data validation (DVAL and list of DV records), generated by the cell table
    aRecList.AppendRecord( mxCellTable->CreateRecord( EXC_ID_DVAL ) );

    if( eBiff == EXC_BIFF8 )
    {
        // all MSODRAWING and OBJ stuff of this sheet goes here
        aRecList.AppendRecord( GetObjectManager().ProcessDrawing( GetSdrPage( mnScTab ) ) );
        // pivot tables
        aRecList.AppendRecord( GetPivotTableManager().CreatePivotTablesRecord( mnScTab ) );
    }

    // list of NOTE records, generated by the cell table
    aRecList.AppendRecord( mxNoteList );

    // sheet view settings: WINDOW2, SCL, PANE, SELECTION
    aRecList.AppendNewRecord( new XclExpTabViewSettings( GetRoot(), mnScTab ) );

    if( eBiff == EXC_BIFF8 )
    {
        // sheet protection options
        Add( new XclExpSheetProtectOptions( GetRoot(), mnScTab ) );

        // enhanced protections if there are
        if (pTabProtect)
        {
            const ::std::vector<ScEnhancedProtection>& rProts( pTabProtect->getEnhancedProtection());
            for (const auto& rProt : rProts)
            {
                Add( new XclExpSheetEnhancedProtection( GetRoot(), rProt));
            }
        }

        // web queries
        Add( new XclExpWebQueryBuffer( GetRoot() ) );

        // conditional formats
        Add( new XclExpCondFormatBuffer( GetRoot(), XclExtLstRef() ) );

        if( HasVbaStorage() && !rCodeName.isEmpty() )
            Add( new XclCodename( rCodeName ) );
    }

    // list of HLINK records, generated by the cell table
    aRecList.AppendRecord( mxCellTable->CreateRecord( EXC_ID_HLINK ) );

    // change tracking
    if( rR.pUserBViewList )
    {
        XclExpUserBViewList::const_iterator iter;
        for ( iter = rR.pUserBViewList->cbegin(); iter != rR.pUserBViewList->cend(); ++iter)
        {
            Add( new XclExpUsersViewBegin( (*iter).GetGUID(), nExcTab ) );
            Add( new XclExpUsersViewEnd );
        }
    }

    // EOF
    Add( new ExcEof );
}

void ExcTable::FillAsTableXml( const OUString& rCodeName )
{
    InitializeTable( mnScTab );

    ScDocument& rDoc = GetDoc();

    OSL_ENSURE( (mnScTab >= 0) && (mnScTab <= MAXTAB), "-ExcTable::Table(): mnScTab - no ordinary table!" );
    OSL_ENSURE( nExcTab <= o3tl::make_unsigned(MAXTAB), "-ExcTable::Table(): nExcTab - no ordinary table!" );

    // create a new OBJ list for this sheet (may be used by notes, autofilter, data validation)
    GetObjectManager().StartSheet();

    // cell table: DEFROWHEIGHT, DEFCOLWIDTH, COLINFO, DIMENSIONS, ROW, cell records
    mxCellTable = new XclExpCellTable( GetRoot() );

    //export cell notes
    std::vector<sc::NoteEntry> aNotes;
    rDoc.GetAllNoteEntries(aNotes);
    for (const auto& rNote : aNotes)
    {
        if (rNote.maPos.Tab() != mnScTab)
            continue;

        mxNoteList->AppendNewRecord(new XclExpNote(GetRoot(), rNote.maPos, rNote.mpNote, u""));
    }

    // WSBOOL needs data from page settings, create it here, add it later
    rtl::Reference<XclExpPageSettings> xPageSett = new XclExpPageSettings( GetRoot() );
    XclExtLstRef xExtLst = new XclExtLst( GetRoot() );
    bool bFitToPages = xPageSett->GetPageData().mbFitToPages;

    bool bSummaryBelow = GetRoot().GetDoc().GetTotalsRowBelow(mnScTab);
    Color aTabColor = GetRoot().GetDoc().GetTabBgColor(mnScTab);
    Add(new XclExpXmlSheetPr(bFitToPages, mnScTab, aTabColor, bSummaryBelow, &GetFilterManager(), rCodeName));

    // GUTS (count & size of outline icons)
    aRecList.AppendRecord( mxCellTable->CreateRecord( EXC_ID_GUTS ) );
    // DEFROWHEIGHT, created by the cell table
    aRecList.AppendRecord( mxCellTable->CreateRecord( EXC_ID2_DEFROWHEIGHT ) );

    aRecList.AppendRecord( mxCellTable->CreateRecord( EXC_ID3_DIMENSIONS ) );

    // sheet view settings: WINDOW2, SCL, PANE, SELECTION
    aRecList.AppendNewRecord( new XclExpTabViewSettings( GetRoot(), mnScTab ) );

    // cell table: DEFCOLWIDTH, COLINFO, DIMENSIONS, ROW, cell records
    aRecList.AppendRecord( mxCellTable );

    // list of NOTE records, generated by the cell table
    // not in the worksheet file
    if( mxNoteList != nullptr && !mxNoteList->IsEmpty() )
        aRecList.AppendNewRecord( new XclExpComments( mnScTab, *mxNoteList, rDoc ) );

    const ScTableProtection* pTabProtect = rDoc.GetTabProtection(mnScTab);
    if (pTabProtect && pTabProtect->isProtected())
        Add( new XclExpSheetProtection(true, mnScTab) );

    lcl_AddScenariosAndFilters( aRecList, GetRoot(), mnScTab );

    // MERGEDCELLS record, generated by the cell table
    aRecList.AppendRecord( mxCellTable->CreateRecord( EXC_ID_MERGEDCELLS ) );

    // conditional formats
    Add( new XclExpCondFormatBuffer( GetRoot(), xExtLst ) );

    Add(new xcl::exp::SparklineBuffer(GetRoot(), xExtLst));

    // data validation (DVAL and list of DV records), generated by the cell table
    aRecList.AppendRecord( mxCellTable->CreateRecord( EXC_ID_DVAL ) );

    // list of HLINK records, generated by the cell table
    XclExpRecordRef xHyperlinks = mxCellTable->CreateRecord( EXC_ID_HLINK );
    XclExpHyperlinkList* pHyperlinkList = dynamic_cast<XclExpHyperlinkList*>(xHyperlinks.get());
    if( pHyperlinkList != nullptr && !pHyperlinkList->IsEmpty() )
    {
        aRecList.AppendNewRecord( new XclExpXmlStartElementRecord( XML_hyperlinks ) );
        aRecList.AppendRecord( xHyperlinks );
        aRecList.AppendNewRecord( new XclExpXmlEndElementRecord( XML_hyperlinks ) );
    }

    aRecList.AppendRecord( xPageSett );

    std::unique_ptr<XclExpImgData> pImgData(xPageSett->getGraphicExport());
    // all MSODRAWING and OBJ stuff of this sheet goes here
    aRecList.AppendRecord( GetObjectManager().ProcessDrawing( GetSdrPage( mnScTab ), std::move(pImgData) ) );

    // <tableParts> after <drawing> and before <extLst>
    aRecList.AppendRecord( GetTablesManager().GetTablesBySheet( mnScTab));

    // queryTable parts (no wrapper element in sheet XML, only .rels entries)
    aRecList.AppendRecord( GetQueryTablesManager().GetQueryTablesBySheet( mnScTab ));

    aRecList.AppendNewRecord(new xcl::exp::NamedSheetViews(GetRoot(), mnScTab));

    aRecList.AppendRecord( xExtLst );
}

void ExcTable::FillAsEmptyTable( const OUString& rCodeName )
{
    InitializeTable( mnScTab );

    if( !HasVbaStorage() )
        return;

    if( GetBiff() <= EXC_BIFF5 )
    {
        Add( new ExcBof );
    }
    else
    {
        Add( new ExcBof8 );
        Add( new XclCodename( rCodeName ) );
    }
    // sheet view settings: WINDOW2, SCL, PANE, SELECTION
    aRecList.AppendNewRecord( new XclExpTabViewSettings( GetRoot(), mnScTab ) );
    Add( new ExcEof );
}

void ExcTable::Write( XclExpStream& rStrm )
{
    SetCurrScTab( mnScTab );
    if( mxCellTable )
        mxCellTable->Finalize(true);
    aRecList.Save( rStrm );
}

void ExcTable::WriteXml( XclExpXmlStream& rStrm )
{
    if (!GetTabInfo().IsExportTab(mnScTab))
    {
        // header export.
        SetCurrScTab(mnScTab);
        if (mxCellTable)
            mxCellTable->Finalize(false);
        aRecList.SaveXml(rStrm);

        return;
    }

    // worksheet export
    OUString sSheetName = XclXmlUtils::GetStreamName( "xl/", "worksheets/sheet", mnScTab+1 );

    sax_fastparser::FSHelperPtr pWorksheet = rStrm.GetStreamForPath( sSheetName );

    rStrm.PushStream( pWorksheet );

    pWorksheet->startElement( XML_worksheet,
        XML_xmlns, rStrm.getNamespaceURL(OOX_NS(xls)),
        FSNS(XML_xmlns, XML_r), rStrm.getNamespaceURL(OOX_NS(officeRel)),
        FSNS(XML_xmlns, XML_xdr), "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing", // rStrm.getNamespaceURL(OOX_NS(xm)) -> "http://schemas.microsoft.com/office/excel/2006/main",
        FSNS(XML_xmlns, XML_x14), rStrm.getNamespaceURL(OOX_NS(xls14Lst)),
        FSNS(XML_xmlns, XML_xr2), rStrm.getNamespaceURL(OOX_NS(xr2)),
        FSNS(XML_xmlns, XML_mc), rStrm.getNamespaceURL(OOX_NS(mce)));

    SetCurrScTab( mnScTab );
    if (mxCellTable)
        mxCellTable->Finalize(false);
    aRecList.SaveXml( rStrm );

    XclExpXmlPivotTables* pPT = GetXmlPivotTableManager().GetTablesBySheet(mnScTab);
    if (pPT)
        pPT->SaveXml(rStrm);

    rStrm.GetCurrentStream()->endElement( XML_worksheet );
    rStrm.PopStream();
}

ExcDocument::ExcDocument( const XclExpRoot& rRoot ) :
    XclExpRoot( rRoot ),
    aHeader( rRoot )
{
}

ExcDocument::~ExcDocument()
{
    maTableList.RemoveAllRecords();    // for the following assertion!
}

void ExcDocument::ReadDoc()
{
    InitializeConvert();

    if (GetOutput() == EXC_OUTPUT_BINARY)
        aHeader.FillAsHeaderBinary(maBoundsheetList);
    else
    {
        aHeader.FillAsHeaderXml(maBoundsheetList);
        GetXmlPivotTableManager().Initialize();
        GetTablesManager().Initialize();    // Move outside conditions if we wanted to support BIFF.
        GetQueryTablesManager().Initialize();
    }

    SCTAB nScTab = 0, nScTabCount = GetTabInfo().GetScTabCount();
    SCTAB nCodeNameIdx = 0, nCodeNameCount = GetExtDocOptions().GetCodeNameCount();
    // sheetPr/@codeName from the live sheet code names. The BIFF CODENAME records from the ExtDocOptions list, each
    // sheet taking its own listed name (lcl_GetListedBiffCodeNames), or from the live code names when the import left
    // that list empty (lcl_UseLiveBiffCodeNames).
    std::vector< OUString > aListedCodeNames, aPadCodeNames;
    lcl_GetListedBiffCodeNames( GetRoot(), aListedCodeNames, aPadCodeNames );
    const std::vector< OUString > aCodeNames
        = ( GetOutput() != EXC_OUTPUT_BINARY || lcl_UseLiveBiffCodeNames( GetRoot() ) )
        ? lcl_GetXmlSheetCodeNames( GetRoot() ) : aListedCodeNames;

    for( ; nScTab < nScTabCount; ++nScTab )
    {
        if( GetTabInfo().IsExportTab( nScTab ) )
        {
            ExcTableList::RecordRefType xTab = new ExcTable( GetRoot(), nScTab );
            maTableList.AppendRecord( xTab );
            if (GetOutput() == EXC_OUTPUT_BINARY)
                xTab->FillAsTableBinary( aCodeNames[ nScTab ] );
            else
                xTab->FillAsTableXml( aCodeNames[ nScTab ] );

            ++nCodeNameIdx;
        }
    }
    for( size_t nPad = 0; nCodeNameIdx < nCodeNameCount; ++nScTab, ++nCodeNameIdx, ++nPad )
    {
        ExcTableList::RecordRefType xTab = new ExcTable( GetRoot(), nScTab );
        maTableList.AppendRecord( xTab );
        xTab->FillAsEmptyTable( nPad < aPadCodeNames.size() ? aPadCodeNames[ nPad ] : OUString() );
    }

    if ( GetBiff() == EXC_BIFF8 )
    {
        // complete temporary Escher stream
        GetObjectManager().EndDocument();

        // change tracking
        if ( GetDoc().GetChangeTrack() )
            m_xExpChangeTrack.reset(new XclExpChangeTrack( GetRoot() ));
    }
}

void ExcDocument::Write( SvStream& rSvStrm )
{
    if( !maTableList.IsEmpty() )
    {
        InitializeSave();

        XclExpStream aXclStrm( rSvStrm, GetRoot() );

        aHeader.Write( aXclStrm );

        OSL_ENSURE( maTableList.GetSize() == maBoundsheetList.GetSize(),
            "ExcDocument::Write - different number of sheets and BOUNDSHEET records" );

        for( size_t nTab = 0, nTabCount = maTableList.GetSize(); nTab < nTabCount; ++nTab )
        {
            // set current stream position in BOUNDSHEET record
            ExcBoundsheetRef xBoundsheet = maBoundsheetList.GetRecord( nTab );
            if( xBoundsheet )
                xBoundsheet->SetStreamPos( aXclStrm.GetSvStreamPos() );
            // write the table
            maTableList.GetRecord( nTab )->Write( aXclStrm );
        }

        // write the table stream positions into the BOUNDSHEET records
        for( size_t nBSheet = 0, nBSheetCount = maBoundsheetList.GetSize(); nBSheet < nBSheetCount; ++nBSheet )
            maBoundsheetList.GetRecord( nBSheet )->UpdateStreamPos( aXclStrm );
    }
    if( m_xExpChangeTrack )
        m_xExpChangeTrack->Write();
}

void ExcDocument::WriteXml( XclExpXmlStream& rStrm )
{
    ScDocShell* pDocShell = GetDocShell();

    using namespace ::com::sun::star;
    uno::Reference<document::XDocumentPropertiesSupplier> xDPS( static_cast<cppu::OWeakObject*>(pDocShell->GetModel()), uno::UNO_QUERY_THROW );
    uno::Reference<document::XDocumentProperties> xDocProps = xDPS->getDocumentProperties();

    OUString sUserName = GetUserName();
    sal_uInt32 nWriteProtHash = pDocShell->GetModifyPasswordHash();
    bool bHasPasswordHash = nWriteProtHash && !sUserName.isEmpty();
    const cpo::uno::Sequence<beans::PropertyValue> aInfo = pDocShell->GetModifyPasswordInfo();
    OUString sAlgorithm, sSalt, sHash;
    sal_Int32 nCount = 0;
    for (const auto& prop : aInfo)
    {
        if (prop.Name == "algorithm-name")
            prop.Value >>= sAlgorithm;
        else if (prop.Name == "salt")
            prop.Value >>= sSalt;
        else if (prop.Name == "iteration-count")
            prop.Value >>= nCount;
        else if (prop.Name == "hash")
            prop.Value >>= sHash;
    }
    bool bHasPasswordInfo
        = sAlgorithm != "PBKDF2" && !sSalt.isEmpty() && !sHash.isEmpty() && !sUserName.isEmpty();
    rStrm.exportDocumentProperties(xDocProps, pDocShell->IsSecurityOptOpenReadOnly()
                                                  && !bHasPasswordHash && !bHasPasswordInfo);
    rStrm.exportCustomFragments(rStrm.GetCurrentStream());

    sax_fastparser::FSHelperPtr& rWorkbook = rStrm.GetCurrentStream();
    rWorkbook->startElement( XML_workbook,
            XML_xmlns, rStrm.getNamespaceURL(OOX_NS(xls)),
            FSNS(XML_xmlns, XML_r), rStrm.getNamespaceURL(OOX_NS(officeRel)),
            // the following are for chartex
            FSNS(XML_xmlns, XML_mc), rStrm.getNamespaceURL(OOX_NS(mce)),
            FSNS(XML_xmlns, XML_x15), rStrm.getNamespaceURL(OOX_NS(x15)),
            FSNS(XML_xmlns, XML_xr), rStrm.getNamespaceURL(OOX_NS(xr)),
            FSNS(XML_xmlns, XML_xr6), rStrm.getNamespaceURL(OOX_NS(xr6)),
            FSNS(XML_xmlns, XML_xr10), rStrm.getNamespaceURL(OOX_NS(xr10)),
            FSNS(XML_xmlns, XML_xr2), rStrm.getNamespaceURL(OOX_NS(xr2)) );

    rtl::Reference<sax_fastparser::FastAttributeList> pAttrListFileVersion
        = sax_fastparser::FastSerializerHelper::createAttrList();
    pAttrListFileVersion->add(XML_appName, "Calc");
    std::optional<sal_Int16> oLow = GetExtDocOptions().GetDocSettings().moLowestEdited;
    if (rStrm.getVersion() == oox::core::ECMA_376_1ST_EDITION
        && (!oLow.has_value() || oLow > 4))
    {
        oLow = 4; // when saving as MS Excel 2007, set the corresponding lowestEdited-by version
    }
    if (oLow.has_value())
        pAttrListFileVersion->add(XML_lowestEdited, OString::number(*oLow));
            // OOXTODO: XML_codeName
            // OOXTODO: XML_lastEdited
            // OOXTODO: XML_rupBuild
    rWorkbook->singleElement(XML_fileVersion, pAttrListFileVersion);

    if (bHasPasswordHash)
        rWorkbook->singleElement(XML_fileSharing,
                XML_userName, sUserName,
                XML_reservationPassword, OString::number(nWriteProtHash, 16));
    else if (bHasPasswordInfo)
        rWorkbook->singleElement(XML_fileSharing,
                XML_userName, sUserName,
                XML_algorithmName, sAlgorithm,
                XML_hashValue, sHash,
                XML_saltValue, sSalt,
                XML_spinCount, OString::number(nCount));

    if( !maTableList.IsEmpty() )
    {
        InitializeSave();

        auto* pDrawLayer = GetDoc().GetDrawLayer();
        if (pDrawLayer)
        {
            std::shared_ptr<model::Theme> pTheme = pDrawLayer->getTheme();
            if (pTheme)
            {
                OUString sThemeRelationshipPath = u"theme/theme1.xml"_ustr;
                OUString sThemeDocumentPath = "xl/" + sThemeRelationshipPath;

                oox::ThemeExport aThemeExport(&rStrm, oox::drawingml::DOCUMENT_XLSX);
                aThemeExport.write(sThemeDocumentPath, *pTheme);

                // xl/_rels/workbook.xml.rels
                // TODO: check if Theme import & export work correctly
                rStrm.addRelation(rStrm.GetCurrentStream()->getOutputStream(),
                                  oox::getRelationship(Relationship::THEME),
                                  sThemeRelationshipPath);
            }
        }

        aHeader.WriteXml( rStrm );

        for( size_t nTab = 0, nTabCount = maTableList.GetSize(); nTab < nTabCount; ++nTab )
        {
            // write the table
            maTableList.GetRecord( nTab )->WriteXml( rStrm );
        }

        // xl/metadata.xml: emit the dynamic array property metadata block.
        if (rStrm.HasDynamicArrayFormula())
        {
            sax_fastparser::FSHelperPtr pMetadata = rStrm.CreateOutputStream(
                u"xl/metadata.xml"_ustr,
                u"metadata.xml",
                rStrm.GetCurrentStream()->getOutputStream(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml",
                oox::getRelationship(Relationship::SHEETMETADATA));

            pMetadata->startElement(XML_metadata,
                XML_xmlns, rStrm.getNamespaceURL(OOX_NS(xls)),
                FSNS(XML_xmlns, XML_xda), rStrm.getNamespaceURL(OOX_NS(xda)));

            pMetadata->startElement(XML_metadataTypes, XML_count, "1");
            pMetadata->singleElement(XML_metadataType,
                XML_name, "XLDAPR",
                XML_minSupportedVersion, "120000",
                XML_copy, "1", XML_pasteAll, "1", XML_pasteValues, "1",
                XML_merge, "1", XML_splitFirst, "1", XML_rowColShift, "1",
                XML_clearFormats, "1", XML_clearComments, "1",
                XML_assign, "1", XML_coerce, "1", XML_cellMeta, "1");
            pMetadata->endElement(XML_metadataTypes);

            pMetadata->startElement(XML_futureMetadata,
                XML_name, "XLDAPR", XML_count, "1");
            pMetadata->startElement(XML_bk);
            pMetadata->startElement(XML_extLst);
            pMetadata->startElement(XML_ext,
                XML_uri, "{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}");
            pMetadata->singleElement(FSNS(XML_xda, XML_dynamicArrayProperties),
                XML_fDynamic, "1", XML_fCollapsed, "0");
            pMetadata->endElement(XML_ext);
            pMetadata->endElement(XML_extLst);
            pMetadata->endElement(XML_bk);
            pMetadata->endElement(XML_futureMetadata);

            pMetadata->startElement(XML_cellMetadata, XML_count, "1");
            pMetadata->startElement(XML_bk);
            pMetadata->singleElement(XML_rc, XML_t, "1", XML_v, "0");
            pMetadata->endElement(XML_bk);
            pMetadata->endElement(XML_cellMetadata);

            pMetadata->endElement(XML_metadata);
        }
    }

    if( m_xExpChangeTrack )
        m_xExpChangeTrack->WriteXml( rStrm );

    XclExpXmlPivotCaches& rCaches = GetXmlPivotTableManager().GetCaches();
    if (rCaches.HasCaches())
        rCaches.SaveXml(rStrm);

    const ScCalcConfig& rCalcConfig = GetDoc().GetCalcConfig();
    formula::FormulaGrammar::AddressConvention eConv = rCalcConfig.meStringRefAddressSyntax;

    // don't save "unspecified" string ref syntax ... query formula grammar
    // and save that instead
    if( eConv == formula::FormulaGrammar::CONV_UNSPECIFIED)
    {
        eConv = GetDoc().GetAddressConvention();
    }

    ScDocument& rDoc = GetDoc();
    bool connectionXml = rDoc.hasConnectionXml();
    const ConnectionVector& vConnVector = rDoc.getConnectionVector();

    if (connectionXml && !vConnVector.empty())
    {
        // save xl/connections.xml reference into [Content_Types].xml and open stream to xl/connections.xml
        sax_fastparser::FSHelperPtr aConnectionsXml = rStrm.CreateOutputStream(
            u"xl/connections.xml"_ustr, u"connections.xml", rStrm.GetCurrentStream()->getOutputStream(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml",
            oox::getRelationship(Relationship::CONNECTIONS));
        rStrm.PushStream(aConnectionsXml);

        /*
            <connections
            xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16"
            mc:Ignorable="xr16">
        */

        // write into xl/connections.xml
        // export <connections>
        aConnectionsXml->startElement(
            XML_connections, XML_xmlns, rStrm.getNamespaceURL(OOX_NS(xls)), FSNS(XML_xmlns, XML_mc),
            rStrm.getNamespaceURL(OOX_NS(mce)), FSNS(XML_xmlns, XML_xr16),
            rStrm.getNamespaceURL(OOX_NS(xr16)), FSNS(XML_mc, XML_Ignorable), "xr16");

        // get a list of <connection> element and export it with its child elements
        for (const auto& rConnection : vConnVector)
        {
            const oox::xls::ConnectionModel& rModel = rConnection->getModel();

            if (rModel.mnId == -1 || rModel.mnRefreshedVersion == -1)
                continue; // incorrect values, skip

            rtl::Reference<sax_fastparser::FastAttributeList> pAttrList
                = sax_fastparser::FastSerializerHelper::createAttrList();

            pAttrList->add(XML_id, OUString::number(rModel.mnId));

            if (!rModel.maXr16Uid.isEmpty())
                pAttrList->add(FSNS(XML_xr16, XML_uid), rModel.maXr16Uid);
            if (!rModel.maSourceFile.isEmpty())
                pAttrList->add(XML_sourceFile, rModel.maSourceFile);
            if (!rModel.maSourceConnFile.isEmpty())
                pAttrList->add(XML_odcFile, rModel.maSourceConnFile);

            pAttrList->add(XML_keepAlive, ToPsz10(rModel.mbKeepAlive));
            pAttrList->add(XML_interval, OUString::number(rModel.mnInterval));

            if (!rModel.maName.isEmpty())
                pAttrList->add(XML_name, rModel.maName);
            if (!rModel.maDescription.isEmpty())
                pAttrList->add(XML_description, rModel.maDescription);
            if (OUString::number(rModel.mnType).length > 0)
                pAttrList->add(XML_type, OUString::number(rModel.mnType));

            pAttrList->add(XML_reconnectionMethod, OUString::number(rModel.mnReconnectMethod));
            pAttrList->add(XML_refreshedVersion, OUString::number(rModel.mnRefreshedVersion));
            pAttrList->add(XML_minRefreshableVersion,
                           OUString::number(rModel.mnMinRefreshableVersion));
            pAttrList->add(XML_savePassword, ToPsz10(rModel.mbSavePassword));
            pAttrList->add(XML_new, ToPsz10(rModel.mbNew));
            pAttrList->add(XML_deleted, ToPsz10(rModel.mbDeleted));
            pAttrList->add(XML_onlyUseConnectionFile, ToPsz10(rModel.mbOnlyUseConnFile));
            pAttrList->add(XML_background, ToPsz10(rModel.mbBackground));
            pAttrList->add(XML_refreshOnLoad, ToPsz10(rModel.mbRefreshOnLoad));
            pAttrList->add(XML_saveData, ToPsz10(rModel.mbSaveData));

            // import credentials="" attribute of <connection> element
            if (rModel.mnCredentials != -1)
            {
                sal_Int32 nToken = rModel.mnCredentials;
                OUString nValue;

                switch (nToken)
                {
                    case XML_none:
                        nValue = u"none"_ustr;
                        break;
                    case XML_stored:
                        nValue = u"stored"_ustr;
                        break;
                    case XML_prompt:
                        nValue = u"prompt"_ustr;
                        break;
                    default:
                        nValue = u"integrated"_ustr;
                        break;
                }

                pAttrList->add(XML_credentials, nValue);
            }

            if (!rModel.maSsoId.isEmpty())
                pAttrList->add(XML_singleSignOnId, rModel.maSsoId);

            // export <connection> with attributes
            rStrm.GetCurrentStream()->startElement(XML_connection, pAttrList);

            /*
                start export child elements of <connection>

                <xsd:sequence>
                    <xsd:element name="dbPr" minOccurs="0" maxOccurs="1" type="CT_DbPr"/>
                    <xsd:element name="olapPr" minOccurs="0" maxOccurs="1" type="CT_OlapPr"/>
                    <xsd:element name="webPr" minOccurs="0" maxOccurs="1" type="CT_WebPr"/>
                    <xsd:element name="textPr" minOccurs="0" maxOccurs="1" type="CT_TextPr"/>
                    <xsd:element name="parameters" minOccurs="0" maxOccurs="1" type="CT_Parameters"/>
                    <xsd:element name="extLst" minOccurs="0" maxOccurs="1" type="CT_ExtensionList"/>
                </xsd:sequence>
            */

            cpo::uno::Sequence<cpo::uno::Any> aSeqs;
            aSeqs = rConnection->getDbPrSequenceAny();
            // export <dbPr> if not empty
            if (aSeqs.hasElements())
            {
                rtl::Reference<sax_fastparser::FastAttributeList> pAttrListDbPr
                    = sax_fastparser::FastSerializerHelper::createAttrList();

                addElemensToAttrList(pAttrListDbPr, aSeqs);

                rStrm.GetCurrentStream()->singleElement(XML_dbPr, pAttrListDbPr);
            }

            aSeqs = rConnection->getOlapPrSequenceAny();
            // export <olapPr> if not empty
            if (aSeqs.hasElements())
            {
                rtl::Reference<sax_fastparser::FastAttributeList> pAttrListOlapPr
                    = sax_fastparser::FastSerializerHelper::createAttrList();

                addElemensToAttrList(pAttrListOlapPr, aSeqs);

                rStrm.GetCurrentStream()->singleElement(XML_olapPr, pAttrListOlapPr);
            }

            { // export <webPr> and its child elements
                rtl::Reference<sax_fastparser::FastAttributeList> pAttrListWebPr
                    = sax_fastparser::FastSerializerHelper::createAttrList();

                if (rModel.mxWebPr)
                {
                    pAttrListWebPr->add(XML_xml, ToPsz10(rModel.mxWebPr->mbXml));
                    pAttrListWebPr->add(XML_sourceData, ToPsz10(rModel.mxWebPr->mbSourceData));
                    pAttrListWebPr->add(XML_parsePre, ToPsz10(rModel.mxWebPr->mbParsePre));
                    pAttrListWebPr->add(XML_consecutive, ToPsz10(rModel.mxWebPr->mbConsecutive));
                    pAttrListWebPr->add(XML_firstRow, ToPsz10(rModel.mxWebPr->mbFirstRow));
                    pAttrListWebPr->add(XML_xl97, ToPsz10(rModel.mxWebPr->mbXl97Created));
                    pAttrListWebPr->add(XML_textDates, ToPsz10(rModel.mxWebPr->mbTextDates));
                    pAttrListWebPr->add(XML_xl2000, ToPsz10(rModel.mxWebPr->mbXl2000Refreshed));
                    pAttrListWebPr->add(XML_htmlTables, ToPsz10(rModel.mxWebPr->mbHtmlTables));

                    if (!rModel.mxWebPr->maUrl.isEmpty())
                        pAttrListWebPr->add(XML_url, rModel.mxWebPr->maUrl);
                    if (!rModel.mxWebPr->maPostMethod.isEmpty())
                        pAttrListWebPr->add(XML_post, rModel.mxWebPr->maPostMethod);
                    if (!rModel.mxWebPr->maEditPage.isEmpty())
                        pAttrListWebPr->add(XML_editPage, rModel.mxWebPr->maEditPage);

                    // import htmlFormat="" attribute of <webPr> element
                    if (rModel.mxWebPr->mnHtmlFormat != -1)
                    {
                        sal_Int32 nToken = rModel.mxWebPr->mnHtmlFormat;
                        OUString nValue;

                        switch (nToken)
                        {
                            case XML_all:
                                nValue = u"all"_ustr;
                                break;
                            case XML_rtf:
                                nValue = u"rtf"_ustr;
                                break;
                            default:
                                nValue = u"none"_ustr;
                                break;
                        }

                        pAttrListWebPr->add(XML_htmlFormat, nValue);
                    }

                    // export <webPr> with attributes
                    rStrm.GetCurrentStream()->startElement(XML_webPr, pAttrListWebPr);

                    { // export <tables> and its child elements

                        rtl::Reference<sax_fastparser::FastAttributeList> pAttrListTables
                            = sax_fastparser::FastSerializerHelper::createAttrList();

                        // <tables count="<xsd:unsignedInt>">
                        if (rModel.mxWebPr->mnCount >= 0 && !rModel.mxWebPr->maTables.empty())
                        {
                            pAttrListTables->add(XML_count,
                                                 OUString::number(rModel.mxWebPr->mnCount));

                            // export <tables> with attributes
                            rStrm.GetCurrentStream()->startElement(XML_tables, pAttrListTables);

                            { // export <m>, <s> and <x> elements
                                for (auto& tableElement : rModel.mxWebPr->maTables)
                                {
                                    OUString sElement;
                                    tableElement >>= sElement;
                                    OUString token = sElement.getToken(0, ',');
                                    OUString attributeValue = sElement.getToken(1, ',');

                                    if (token == "s")
                                        rStrm.GetCurrentStream()->singleElement(XML_s, XML_v,
                                                                                attributeValue);
                                    else if (token == "x")
                                        rStrm.GetCurrentStream()->singleElement(XML_x, XML_v,
                                                                                attributeValue);
                                    else
                                        rStrm.GetCurrentStream()->singleElement(XML_m);
                                }
                            }

                            // put </tables>
                            rStrm.GetCurrentStream()->endElement(XML_tables);
                        }
                    }

                    // put </webPr>
                    rStrm.GetCurrentStream()->endElement(XML_webPr);
                }
            }

            { // export <textPr>

                rtl::Reference<sax_fastparser::FastAttributeList> pAttrListTextPr
                    = sax_fastparser::FastSerializerHelper::createAttrList();

                if (rModel.mxTextPr)
                {
                    addElemensToAttrList(pAttrListTextPr, rModel.mxTextPr->maTextPrSequenceAny);

                    rStrm.GetCurrentStream()->startElement(XML_textPr, pAttrListTextPr);

                    { // export <textFields>
                        rtl::Reference<sax_fastparser::FastAttributeList> pAttrListTextFields
                            = sax_fastparser::FastSerializerHelper::createAttrList();

                        addElemensToAttrList(pAttrListTextFields,
                                             rModel.mxTextPr->maTextFieldsSequenceAny);

                        rStrm.GetCurrentStream()->startElement(XML_textFields, pAttrListTextFields);

                        { // export <textField>

                            for (auto& textFieldAttr : rModel.mxTextPr->vTextField)
                            {
                                rtl::Reference<sax_fastparser::FastAttributeList> pAttrListTextField
                                    = sax_fastparser::FastSerializerHelper::createAttrList();

                                addElemensToAttrList(pAttrListTextField, textFieldAttr);

                                rStrm.GetCurrentStream()->singleElement(XML_textField,
                                                                        pAttrListTextField);
                            }
                        }

                        // put </textFields>
                        rStrm.GetCurrentStream()->endElement(XML_textFields);
                    }

                    // put </textPr>
                    rStrm.GetCurrentStream()->endElement(XML_textPr);
                }
            }

            { // export <parameters>

                rtl::Reference<sax_fastparser::FastAttributeList> pAttrListParameters
                    = sax_fastparser::FastSerializerHelper::createAttrList();

                if (rModel.mxParameters && rModel.mxParameters->mnCount > -1)
                {
                    pAttrListParameters->add(XML_count,
                                             OUString::number(rModel.mxParameters->mnCount));

                    rStrm.GetCurrentStream()->startElement(XML_parameters, pAttrListParameters);

                    // export <parameter>
                    for (auto& parameterAttr : rModel.mxParameters->vParameter)
                    {
                        rtl::Reference<sax_fastparser::FastAttributeList> pAttrListParameter
                            = sax_fastparser::FastSerializerHelper::createAttrList();

                        addElemensToAttrList(pAttrListParameter, parameterAttr);

                        rStrm.GetCurrentStream()->singleElement(XML_parameter, pAttrListParameter);
                    }

                    // put </parameters>
                    rStrm.GetCurrentStream()->endElement(XML_parameters);
                }
            }

            // export <extLst>
            if (rModel.mxExtensionList)
            {
                // put <extLst>, it has no attributes
                rStrm.GetCurrentStream()->startElement(XML_extLst);

                // export <ext> with uri attribute and xmlns:x15 namespace.
                for (auto& uriValue : rModel.mxExtensionList->vExtension)
                {
                    rStrm.GetCurrentStream()->startElement(XML_ext, FSNS(XML_xmlns, XML_x15),
                                                           rStrm.getNamespaceURL(OOX_NS(x15)),
                                                           XML_uri, uriValue);

                    /*
                        Export child elements of <ext> here.
                        We should export "any element in any namespace" when it is needed.

                        <extLst>
                            <ext>
                                (Any element in any namespace)
                            </ext>
                        </extLst>
                    */

                    // export <x15:connection> if not empty
                    aSeqs = rModel.mxExtensionList->maXFifteenConnectionSequenceAny;
                    if (aSeqs.hasElements())
                    {
                        rtl::Reference<sax_fastparser::FastAttributeList>
                            pAttrListXFifteenConnection
                            = sax_fastparser::FastSerializerHelper::createAttrList();

                        addElemensToAttrList(pAttrListXFifteenConnection, aSeqs);

                        rStrm.GetCurrentStream()->startElement(FSNS(XML_x15, XML_connection),
                                                               pAttrListXFifteenConnection);

                        // export <x15:rangePr> if not empty
                        aSeqs = rModel.mxExtensionList->maXFifteenRangePrSequenceAny;
                        if (aSeqs.hasElements())
                        {
                            rtl::Reference<sax_fastparser::FastAttributeList>
                                pAttrListXFifteenRangePr
                                = sax_fastparser::FastSerializerHelper::createAttrList();

                            addElemensToAttrList(pAttrListXFifteenRangePr, aSeqs);

                            // put <x15:rangePr />
                            rStrm.GetCurrentStream()->singleElement(FSNS(XML_x15, XML_rangePr),
                                                                    pAttrListXFifteenRangePr);
                        }

                        // put </x15:connection>
                        rStrm.GetCurrentStream()->endElement(FSNS(XML_x15, XML_connection));
                    }

                    // put </ext>
                    rStrm.GetCurrentStream()->endElement(XML_ext);
                }

                // put </extLst>
                rStrm.GetCurrentStream()->endElement(XML_extLst);
            }

            // put </connection>
            rStrm.GetCurrentStream()->endElement(XML_connection);
        }

        // put </connections>
        aConnectionsXml->endElement(XML_connections);
        rStrm.PopStream();
    }

    if (rDoc.hasCustomXml())
    {
        // export customXml/item1.xml into xl/_rels/workbook.xml.rels
        OUString sCustomXmlPath = OUString::Concat("../") + rDoc.getCustomXmlItems();

        // FIXME: what if there are customXml/item2.xml, customXml/item3.xml etc?
        // we need to save all customXml/item*.xml paths into ScDocument from XmlFilterBase::importCustomFragments
        // then we should get them with rDoc here.
        rStrm.addRelation(rStrm.GetCurrentStream()->getOutputStream(),
                          oox::getRelationship(Relationship::CUSTOMXML), sCustomXmlPath);
    }

    if (rDoc.hasXmlMaps())
    {
        // save xl/xmlMaps.xml relationship into xl/_rels/workbook.xml.rels
        // save xl/xmlMaps.xml reference into [Content_Types].xml and open stream to xl/xmlMaps.xml
        sax_fastparser::FSHelperPtr aXmlMapsXml = rStrm.CreateOutputStream(
            u"xl/xmlMaps.xml"_ustr, u"xmlMaps.xml", rStrm.GetCurrentStream()->getOutputStream(),
            "application/xml", oox::getRelationship(Relationship::XMLMAPS));

        // start exporting xl/xmlMaps.xml
        /* this adds <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        XML declaration automatically at the top of the file. */
        rStrm.PushStream(aXmlMapsXml);

        // get xmlMaps.xml content as string
        std::string sXmlMapsContent = rDoc.getXmlMapsItem();

        /* we should remove <?xml version="1.0" encoding="UTF-8"?>
        XML declaration from the string as rStrm.PushStream() already adds it. */
        const std::size_t nXmlDeclarationLocation = sXmlMapsContent.find("?>");

        // but there may not be an XML declaration, we should also check that.
        if (nXmlDeclarationLocation != std::string::npos)
            sXmlMapsContent = sXmlMapsContent.substr(nXmlDeclarationLocation + 2);

        // write contents into xl/xmlMaps.xml
        rStrm.GetCurrentStream()->write(sXmlMapsContent);

        rStrm.PopStream();
    }

    // write if it has been read|imported or explicitly changed
    // or if ref syntax isn't what would be native for our file format
    // i.e. ExcelA1 in this case
    if ( rCalcConfig.mbHasStringRefSyntax ||
         (eConv != formula::FormulaGrammar::CONV_XL_A1) )
    {
        XclExtLstRef xExtLst = new XclExtLst( GetRoot()  );
        xExtLst->AddRecord( new XclExpExtCalcPr( GetRoot(), eConv )  );
        xExtLst->SaveXml(rStrm);
    }

    // Write persons part for threaded comments.
    const auto& rPersonList = rDoc.GetPersonList();
    if (!rPersonList.empty())
    {
        sax_fastparser::FSHelperPtr pPersons = rStrm.CreateOutputStream(
            u"xl/persons/person.xml"_ustr, u"persons/person.xml",
            rStrm.GetCurrentStream()->getOutputStream(), "application/vnd.ms-excel.person+xml",
            oox::getRelationship(Relationship::PERSON));
        rStrm.PushStream(pPersons);

        pPersons->startElement(XML_personList, XML_xmlns, rStrm.getNamespaceURL(OOX_NS(xthreaded)));

        for (const auto& rPerson : rPersonList)
        {
            pPersons->singleElement(
                XML_person, XML_displayName, rPerson.maDisplayName, XML_id, rPerson.maId,
                XML_userId, sax_fastparser::UseIf(rPerson.maUserId, !rPerson.maUserId.isEmpty()),
                XML_providerId, sax_fastparser::UseIf(rPerson.maProviderId,
                                                      !rPerson.maProviderId.isEmpty()));
        }

        pPersons->endElement(XML_personList);
        rStrm.PopStream();
    }

    rWorkbook->endElement( XML_workbook );
    rWorkbook.reset();
}

void ExcDocument::addElemensToAttrList(const rtl::Reference<sax_fastparser::FastAttributeList>& pAttrList,
                                       cpo::uno::Sequence<cpo::uno::Any>& aSeqs)
{
    cpo::uno::Sequence<css::xml::FastAttribute> aFastSeq;
    cpo::uno::Sequence<css::xml::Attribute> aUnkSeq;

    // TODO: check if aSeqs is empty or not
    for (const auto& a : aSeqs)
    {
        if (a >>= aFastSeq)
        {
            for (const auto& rAttr : aFastSeq)
            {
                // Decode OOXML _xHHHH_ escape sequences so the serializer
                // re-encodes them correctly instead of double-escaping
                // (e.g. _x0000_ -> _x005F_x0000_).
                OUString aDecoded = oox::AttributeConversion::decodeXString(rAttr.Value);
                pAttrList->add(rAttr.Token, aDecoded);
            }
        }
        else if (a >>= aUnkSeq)
        {
            for (const auto& rAttr : aUnkSeq)
            {
                OUString aDecoded = oox::AttributeConversion::decodeXString(rAttr.Value);
                pAttrList->addUnknown(rAttr.NamespaceURL,
                                      OUStringToOString(rAttr.Name, RTL_TEXTENCODING_UTF8),
                                      OUStringToOString(aDecoded, RTL_TEXTENCODING_UTF8));
            }
        }
    }
}

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
