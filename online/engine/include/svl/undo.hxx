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
#ifndef INCLUDED_SVL_UNDO_HXX
#define INCLUDED_SVL_UNDO_HXX

#include <svl/svldllapi.h>
#include <comphelper/kit.hxx>
#include <rtl/ustring.hxx>
#include <tools/datetime.hxx>
#include <o3tl/strong_int.hxx>

#include <functional>
#include <memory>
#include <vector>

typedef o3tl::strong_int<sal_Int32, struct ViewShellIdTag> ViewShellId;

typedef struct _xmlTextWriter* xmlTextWriterPtr;

class SVL_DLLPUBLIC SAL_LOPLUGIN_ANNOTATE("crosscast") SfxRepeatTarget
{
public:
    virtual             ~SfxRepeatTarget() = 0;
};


class SVL_DLLPUBLIC SfxUndoContext
{
public:
    /**
     * Don't undo the top undo action, but an earlier one. It's the caller's responsibility to
     * ensure that the earlier undo action is independent from the following ones.
     */
    virtual size_t GetUndoOffset() { return 0; }

    virtual             ~SfxUndoContext() = 0;
};


class SVL_DLLPUBLIC SfxUndoAction
{
public:
                            SfxUndoAction();
    virtual                 ~SfxUndoAction() COVERITY_NOEXCEPT_FALSE;

    virtual void            Undo();
    virtual void            UndoWithContext( SfxUndoContext& i_context );
    virtual void            Redo();
    virtual void            RedoWithContext( SfxUndoContext& i_context );
    virtual void            Repeat(SfxRepeatTarget&);
    virtual bool            CanRepeat(SfxRepeatTarget&) const;

    virtual bool            Merge( SfxUndoAction *pNextAction );

    virtual OUString    GetComment() const;
    virtual OUString    GetObjDescription() const;
    virtual void SetComment(const OUString& rStr);
    virtual void SetObjDescription(const OUString& rStr);

    virtual OUString    GetRepeatComment(SfxRepeatTarget&) const;
    /// ID of the view shell that created this undo action.
    virtual ViewShellId GetViewShellId() const;
    /// Timestamp when this undo item was created.
    const DateTime& GetDateTime() const;
    virtual void dumpAsXml(xmlTextWriterPtr pWriter) const;

private:
    SfxUndoAction( const SfxUndoAction& ) = delete;
    SfxUndoAction& operator=( const SfxUndoAction& ) = delete;

    DateTime m_aDateTime;
};


/// is a mark on the Undo stack
typedef sal_Int32 UndoStackMark;
#define MARK_INVALID    ::std::numeric_limits< UndoStackMark >::max()

struct MarkedUndoAction
{
    std::unique_ptr<SfxUndoAction>  pAction;
    ::std::vector< UndoStackMark >  aMarks;

    MarkedUndoAction(std::unique_ptr<SfxUndoAction> p) : pAction(std::move(p)) {}
};

/** do not make use of these implementation details, unless you
    really really have to! */
struct SVL_DLLPUBLIC SfxUndoArray
{
    std::vector<MarkedUndoAction> maUndoActions;
    size_t                  nMaxUndoActions;
    size_t                  nCurUndoAction;
    SfxUndoArray            *pFatherUndoArray;

    SfxUndoArray(size_t nMax=0) :
        nMaxUndoActions(nMax), nCurUndoAction(0), pFatherUndoArray(nullptr) {}
    virtual ~SfxUndoArray();

    SfxUndoArray& operator=( SfxUndoArray const & ) = delete; // MSVC2017 workaround
    SfxUndoArray( SfxUndoArray const & ) = delete; // MSVC2017 workaround

    SfxUndoAction* GetUndoAction(size_t idx) { return maUndoActions[idx].pAction.get(); }
    std::unique_ptr<SfxUndoAction> Remove(int idx);
    void Remove( size_t i_pos, size_t i_count );
    void Insert( std::unique_ptr<SfxUndoAction> i_action, size_t i_pos );
};


/** do not make use of these implementation details, unless you
    really really have to! */
class SVL_DLLPUBLIC SfxListUndoAction final : public SfxUndoAction, public SfxUndoArray

/*  [Explanation]

    UndoAction to composite multiple Undos in one UndoAction.
    These actions are used by SfxUndomanager. With < SfxUndoManager::EnterListAction >
    you can go one composite level down and with < SfxUndoManager::LeaveListAction > up again.
    Redo and Undo work element wise on SfxListUndoActions.
*/
{
    struct Impl;
    std::unique_ptr<Impl> mpImpl;

public:

    SfxListUndoAction(
        const OUString &rComment, const OUString& rRepeatComment, sal_uInt16 nId, ViewShellId nViewShellId, SfxUndoArray *pFather );
    virtual ~SfxListUndoAction() override;

    virtual void            Undo() override;
    virtual void            UndoWithContext( SfxUndoContext& i_context ) override;
    virtual void            Redo() override;
    virtual void            RedoWithContext( SfxUndoContext& i_context ) override;
    virtual void            Repeat(SfxRepeatTarget&) override;
    virtual bool            CanRepeat(SfxRepeatTarget&) const override;

    virtual bool            Merge( SfxUndoAction *pNextAction ) override;

    virtual OUString        GetComment() const override;
    void SetComment(const OUString& rComment) override;

    /// See SfxUndoAction::GetViewShellId().
    ViewShellId GetViewShellId() const override;
    virtual OUString        GetRepeatComment(SfxRepeatTarget&) const override;
    sal_uInt16              GetId() const;

    void dumpAsXml(xmlTextWriterPtr pWriter) const override;
};


/**  is a callback interface for notifications about state changes of an SfxUndoManager
*/
class SAL_NO_VTABLE SfxUndoListener
{
public:
    virtual void actionUndone( const OUString& i_actionComment ) = 0;
    virtual void actionRedone( const OUString& i_actionComment ) = 0;
    virtual void undoActionAdded( const OUString& i_actionComment ) = 0;
    virtual void cleared() = 0;
    virtual void clearedRedo() = 0;
    virtual void resetAll() = 0;
    virtual void listActionEntered( const OUString& i_comment ) = 0;
    virtual void listActionLeft( const OUString& i_comment ) = 0;
    virtual void listActionCancelled() = 0;

protected:
    ~SfxUndoListener() {}
};


namespace svl::undo::impl
{
    class UndoManagerGuard;
    class LockGuard;
}

/** Vulcan fork: where one view's own undo (or redo) action sits in a document's
    shared, multi-view undo stack.

    Co-editing keeps ONE undo stack per document, but an action belongs to the view
    that made it. Per-user undo (the Google Docs model) lets a view take back its own
    most recent change even when other views (people, or an AI agent's headless view)
    edited after it, provided that change can be undone out of order without touching
    anything done after it. See SfxUndoManager::LookupViewUndo, and
    docs/architecture/vulcan-office.md, "Per-user undo".
*/
struct SfxViewUndoLookup
{
    enum class Status
    {
        Empty,       ///< nothing to undo (or redo) at all
        OwnTop,      ///< the next action is the view's own: an ordinary undo
        Independent, ///< the view's own action sits below others' actions it provably does not touch
        Blocked,     ///< the view's own action cannot be taken back without touching a later change
        NothingOwn,  ///< every action on the stack belongs to other views
        Busy,        ///< a list action is open (an edit is in flight): nothing can be undone now
        NotMovable   ///< the view's own action is of a kind that is never undone out of order, and
                     ///< other views' actions sit above it: no other view is to blame
    };
    Status eStatus = Status::Empty;
    /// Independent: the offset of the view's own action from the top of the stack.
    size_t nOffset = 0;
    /// Blocked: the view whose later action is in the way. NothingOwn: the view of the top action.
    /// NotMovable: -1 (the view's own action is the reason, not another view's).
    ViewShellId nOtherViewId = ViewShellId(-1);
    /// OwnTop / Independent: how many actions in a row, counted from the top of the stack,
    /// are the view's own (0 when the top one is another view's).
    size_t nOwnRun = 0;
    /// OwnTop / Independent: the view of the first action below that run; -1 when the run
    /// reaches the bottom of the stack (bOwnRunToBottom).
    ViewShellId nBelowOwnRunViewId = ViewShellId(-1);
    /// OwnTop: no other view's action lies below the run.
    bool bOwnRunToBottom = false;

    bool CanDo() const { return eStatus == Status::OwnTop || eStatus == Status::Independent; }

    /** Vulcan fork: the answer for "Undo N" / "Redo N" (the toolbar's undo list). N > 1 is only
        ever an in-order undo of the view's own topmost actions, so it must never reach another
        view's action: it is refused (Blocked, naming the view whose action ends the run) when
        fewer than N actions from the top are the view's own. A run that reaches the bottom of
        the stack needs no refusal: the undo just stops there, as it always has. */
    SfxViewUndoLookup ForCount(size_t nCount) const
    {
        if (nCount <= 1 || !CanDo() || nOwnRun >= nCount || bOwnRunToBottom)
            return *this;
        SfxViewUndoLookup aRet;
        aRet.eStatus = Status::Blocked;
        aRet.nOtherViewId = nBelowOwnRunViewId;
        return aRet;
    }
};

/** Vulcan fork: the dispatch return value of an undo/redo that did nothing, as a JSON string:
    {"vulcanUndo":{"status":"blocked"|"nothing_own"|"busy"|"not_movable"|"empty","otherViewId":N,"command":"undo"|"redo"}}.
    The kit (kit/ChildSession.cpp) turns otherViewId into "the AI" / "a person" before anything
    reaches a browser; it replaces the numeric SID_REPAIRPACKAGE value that made the browser show
    the stock "Conflict Undo/Redo with multiple users" dialog. */
SVL_DLLPUBLIC OUString SfxViewUndoLookupToJson(const SfxViewUndoLookup& rLookup, bool bRedo);

struct SfxUndoManager_Data;
class SVL_DLLPUBLIC SfxUndoManager
{
    std::unique_ptr< SfxUndoManager_Data >
                            m_xData;
public:
    static bool const CurrentLevel = true;
    static bool const TopLevel = false;

                            SfxUndoManager( size_t nMaxUndoActionCount = 20 );
    virtual                 ~SfxUndoManager();

    void SetUndoComment(const OUString& rComment);
    void SetUndoComment(const OUString& rComment, const OUString& rObjDescr);

    void                    SetMaxUndoActionCount( size_t nMaxUndoActionCount );
    size_t                  GetMaxUndoActionCount() const;
    virtual void            AddUndoAction( std::unique_ptr<SfxUndoAction> pAction, bool bTryMerg=false );
    virtual size_t          GetUndoActionCount( bool const i_currentLevel = CurrentLevel ) const;
    OUString                GetUndoActionComment( size_t nNo=0, bool const i_currentLevel = CurrentLevel ) const;
    SfxUndoAction*          GetUndoAction( size_t nNo=0 ) const;
    /// Get info about all undo actions (comment, view shell id, etc.)
    OUString                GetUndoActionsInfo() const;
    virtual size_t          GetRedoActionCount( bool const i_currentLevel = CurrentLevel ) const;
    OUString                GetRedoActionComment( size_t nNo=0, bool const i_currentLevel = CurrentLevel ) const;
    SfxUndoAction* GetRedoAction(size_t nNo = 0) const;
    /// Get info about all redo actions (comment, view shell id, etc.)
    OUString                GetRedoActionsInfo() const;
    virtual bool            Undo();
    virtual bool            Redo();
    /** Clears both the Redo and the Undo stack.
        Will assert and bail out when called while within a list action (<member>IsInListAction</member>).
    */
    virtual void            Clear();
    /** Clears the Redo stack.
        Will assert and bail out when called while within a list action (<member>IsInListAction</member>).
    */
    virtual void            ClearRedo();

    /** leaves any possible open list action (<member>IsInListAction</member>), and clears both the Undo and the
        Redo stack.

        Effectively, calling this method is equivalent to <code>while ( IsInListAction() ) LeaveListAction();</code>,
        followed by <code>Clear()</code>. The only difference to this calling sequence is that Reset is an
        atomic operation, also resulting in only one notification.
    */
    void                    Reset();
    /** determines whether an Undo or Redo is currently running
    */
    bool                    IsDoing() const;
    size_t                  GetRepeatActionCount() const;
    OUString                GetRepeatActionComment( SfxRepeatTarget &rTarget) const;
    bool                    Repeat( SfxRepeatTarget &rTarget );
    bool                    CanRepeat( SfxRepeatTarget &rTarget ) const;
    virtual void            EnterListAction(const OUString &rComment, const OUString& rRepeatComment, sal_uInt16 nId, ViewShellId nViewShellId);
    /** Leaves the list action entered with EnterListAction
        @return the number of the sub actions in the list which has just been left. Note that in case no such
            actions exist, the list action does not contribute to the Undo stack, but is silently removed.
    */
    size_t                  LeaveListAction();

    /** Leaves the list action entered with EnterListAction, and forcefully merges the previous
        action on the stack into the newly created list action.

        Say you have an Undo action A on the stack, then call EnterListAction, followed by one or more calls to
        AddUndoAction, followed by a call to LeaveAndMergeListAction. In opposite to LeaveListAction, your Undo
        stack will now still contain one undo action: the newly created list action, whose first child is the
        original A, whose other children are those you added via AddUndoAction, and whose comment is the same as
        the comment of A.

        Effectively, this means that all actions added between EnterListAction and LeaveAndMergeListAction are
        hidden from the user.

        @return the number of the sub actions in the list which has just been left. Note that in case no such
            actions exist, the list action does not contribute to the Undo stack, but is silently removed.
    */
    size_t                  LeaveAndMergeListAction();
    /// determines whether we're within a ListAction context, i.e. a LeaveListAction/LeaveAndMergeListAction call is pending
    bool                    IsInListAction() const;
    /// Determines how many nested list actions are currently open
    size_t                  GetListActionDepth() const;
    /** Clears the redo stack and removes the top undo action */
    void                    RemoveLastUndoAction();
    /** enables (true) or disables (false) recording of undo actions

        If undo actions are added while undo is disabled, they are deleted.
        Disabling undo does not clear the current undo buffer!

        Multiple calls to <code>EnableUndo</code> are not cumulative. That is, calling <code>EnableUndo( false )</code>
        twice, and then calling <code>EnableUndo( true )</code> means that Undo is enable afterwards.
    */
    void                    EnableUndo( bool bEnable );
    /// returns true if undo is currently enabled.
    /// This returns false if undo was disabled using EnableUndo( false ) and
    /// also during the runtime of the Undo() and Redo() methods.
    bool                    IsUndoEnabled() const;
    /// Adds a new listener to be notified about changes in the UndoManager's state
    void                    AddUndoListener( SfxUndoListener& i_listener );
    void                    RemoveUndoListener( SfxUndoListener& i_listener );
    bool                    IsEmptyActions() const;


    /** marks the current top-level element of the Undo stack, and returns a unique ID for it
    */
    UndoStackMark   MarkTopUndoAction();

    /** removes a mark given by its ID.
        After the call, the mark ID is invalid.

        @return the index at which the mark was removed, or std::numeric_limits<size_t>::max()
                if failed
    */
    size_t RemoveMark(UndoStackMark const i_mark);

    /** determines whether the top action on the Undo stack has a given mark
    */
    bool            HasTopUndoActionMark( UndoStackMark const i_mark );

    /** removes the oldest Undo actions from the stack
    * @returns false if it could not do anything (can happen when the action is very large)
    */
    [[nodiscard]]
    bool            RemoveOldestUndoAction();

    void dumpAsXml(xmlTextWriterPtr pWriter) const;

    /** Vulcan fork: find nViewId's own most recent undo action and decide whether it can be
        undone now, possibly out of order (see SfxViewUndoLookup).

        Only top-level actions are considered; while a list action is open the answer is Busy.
        The view's own action M is the topmost one whose GetViewShellId() is nViewId. When other
        views' actions sit above it, M may be undone out of order only if rCanMove(M) holds and
        rIndependent(M, F) holds for EVERY other-view action F above it and for every other-view
        action F on the redo stack. The predicates are the application's knowledge of what
        an action touches; unknown must mean "not independent".

        The first F that fails is reported as nOtherViewId, nearest to M first. When rCanMove(M)
        fails the answer is NotMovable: M's own kind is the reason, so no other view is named.
    */
    SfxViewUndoLookup LookupViewUndo(
        ViewShellId nViewId,
        const std::function<bool(const SfxUndoAction& rMine)>& rCanMove,
        const std::function<bool(const SfxUndoAction& rMine, const SfxUndoAction& rOther)>& rIndependent) const;

    /** Vulcan fork: redo is per view and IN ORDER only: CanDo() only when the next redo
        action is nViewId's own. Any new action from any view clears the redo stack, so the
        only way to be blocked here is another view's undo landing on top of yours. */
    SfxViewUndoLookup LookupViewRedo(ViewShellId nViewId) const;

protected:
    bool    UndoWithContext( SfxUndoContext& i_context );
    bool    RedoWithContext( SfxUndoContext& i_context );

    // Undoes a specific mark on the undo stack, and removes it from the undo/redo stack,
    // but only in case when the redo stack is empty. This is a dangerous operation, because
    // it undoes out of order.
    void UndoMark(UndoStackMark i_mark);

    void    ImplClearRedo_NoLock( bool const i_currentLevel );

    /** clears all undo actions on the current level, plus all undo actions on superordinate levels,
        as soon as those levels are reached.

        If no list action is active currently, i.e. we're on the top level already, this method is equivalent to
        ->Clear.

        Otherwise, the Undo actions on the current level are removed. Upon leaving the current list action, all
        undo actions on the then-current level are removed, too. This is continued until the top level is reached.
    */
    void    ClearAllLevels();
    virtual void EmptyActionsChanged();

private:
    SAL_DLLPRIVATE size_t  ImplLeaveListAction( const bool i_merge, ::svl::undo::impl::UndoManagerGuard& i_guard );
    SAL_DLLPRIVATE bool    ImplAddUndoAction_NoNotify( std::unique_ptr<SfxUndoAction> pAction, bool bTryMerge, bool bClearRedo, ::svl::undo::impl::UndoManagerGuard& i_guard );
    SAL_DLLPRIVATE void    ImplClearRedo( ::svl::undo::impl::UndoManagerGuard& i_guard, bool const i_currentLevel );
    SAL_DLLPRIVATE void    ImplClearUndo( ::svl::undo::impl::UndoManagerGuard& i_guard );
    SAL_DLLPRIVATE void    ImplClearCurrentLevel_NoNotify( ::svl::undo::impl::UndoManagerGuard& i_guard );
    SAL_DLLPRIVATE size_t  ImplGetRedoActionCount_Lock( bool const i_currentLevel = CurrentLevel ) const;
    SAL_DLLPRIVATE bool    ImplIsUndoEnabled_Lock() const;
    SAL_DLLPRIVATE bool    ImplIsInListAction_Lock() const;
    SAL_DLLPRIVATE void    ImplEnableUndo_Lock( bool const i_enable );

    SAL_DLLPRIVATE bool    ImplUndo( SfxUndoContext* i_contextOrNull );
    SAL_DLLPRIVATE bool    ImplRedo( SfxUndoContext* i_contextOrNull );
    SAL_DLLPRIVATE void    ImplCheckEmptyActions();
    inline  bool    ImplIsEmptyActions() const;

    friend class ::svl::undo::impl::LockGuard;
};

#endif

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
