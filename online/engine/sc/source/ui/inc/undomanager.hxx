/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4; fill-column: 100 -*- */
/*
 * This file is part of the Collabora Office project.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
#pragma once

#include <svx/sdrundomanager.hxx>
#include <rangelst.hxx>

#include <optional>

class SfxViewShell;
class ScSimpleUndo;

class SC_DLLPUBLIC ScUndoManager : public SdrUndoManager
{
public:
    ~ScUndoManager();

    /**
     * Checks if the topmost undo action owned by pView is independent from the topmost action undo
     * action. Sets rOffset to the offset of that independent undo action on success.
     */
    bool IsViewUndoActionIndependent(const SfxViewShell* pView, sal_uInt16& rOffset) const;

    /**
     * Vulcan fork: per-view undo (SfxViewUndoLookup). pView's own most recent action may be
     * undone out of order when every later action by another view, and everything on the
     * redo stack, touches cells that do not intersect it. List actions count as the union of
     * their children -- so an AI batch (Vulcan_BeginUndoBatch) no longer blocks every later
     * human undo. Anything without a known cell range (sheet structure: insert/delete rows,
     * columns or sheets, and every other undo that does not report getAffectedRange)
     * blocks: it can move the addresses other actions store.
     */
    SfxViewUndoLookup LookupViewUndo(const SfxViewShell* pView) const;
    /// Vulcan fork: per-view redo, in order only (SfxUndoManager::LookupViewRedo).
    SfxViewUndoLookup LookupViewRedo(const SfxViewShell* pView) const;

    /// Vulcan fork: every view's Undo/Redo state depends on every view's actions, so
    /// re-query them in all views whenever the stack changes (COKit only).
    virtual void AddUndoAction(std::unique_ptr<SfxUndoAction> pAction, bool bTryMerg = false) override;
    static void InvalidateUndoStateInAllViews();

    /// Make these public
    using SdrUndoManager::UndoWithContext;
    using SdrUndoManager::RedoWithContext;
    using SdrUndoManager::UndoMark;

private:
    /// The cells an action touches: a ScSimpleUndo's range, or the union of a list action's
    /// children; nullopt when any part of it is unknown.
    static std::optional<ScRangeList> getAffectedRangesFromUndo(const SfxUndoAction*);
};

class ScUndoRedoContext final : public SfxUndoContext
{
public:
    void SetUndoOffset(size_t nUndoOffset) { m_nUndoOffset = nUndoOffset; }

    size_t GetUndoOffset() override { return m_nUndoOffset; }

private:
    size_t m_nUndoOffset = 0;
};

/* vim:set shiftwidth=4 softtabstop=4 expandtab cinoptions=b1,g0,N-s cinkeys+=0=break: */
