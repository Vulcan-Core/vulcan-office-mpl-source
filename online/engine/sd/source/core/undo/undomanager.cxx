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

#include <undo/undomanager.hxx>

#include <comphelper/kit.hxx>
#include <sfx2/bindings.hxx>
#include <sfx2/sfxsids.hrc>
#include <sfx2/viewfrm.hxx>
#include <svx/svdobj.hxx>
#include <svx/svdundo.hxx>

#include <set>

using namespace sd;

namespace
{
/// Vulcan fork: collect the shapes an action changes in place; false when it does anything
/// else (or anything unknown), or touches a group or a grouped shape, which makes it immovable
/// and blocking.
bool lcl_CollectShapes(const SfxUndoAction& rAction, std::set<const SdrObject*>& rShapes)
{
    if (auto pGroup = dynamic_cast<const SdrUndoGroup*>(&rAction))
    {
        if (pGroup->GetActionCount() == 0)
            return false;
        for (sal_Int32 i = 0; i < pGroup->GetActionCount(); ++i)
        {
            const SdrUndoAction* pChild = pGroup->GetAction(i);
            if (!pChild || !lcl_CollectShapes(*pChild, rShapes))
                return false;
        }
        return true;
    }

    if (auto pList = dynamic_cast<const SfxListUndoAction*>(&rAction))
    {
        if (pList->maUndoActions.empty())
            return false;
        for (const MarkedUndoAction& rChild : pList->maUndoActions)
        {
            if (!rChild.pAction || !lcl_CollectShapes(*rChild.pAction, rShapes))
                return false;
        }
        return true;
    }

    // In-place changes of one shape: its attributes, its geometry, its position, its text.
    // These hold the shape itself, not a position in a list, so taking one back cannot
    // disturb what other actions stored about other shapes.
    if (dynamic_cast<const SdrUndoAttrObj*>(&rAction) || dynamic_cast<const SdrUndoGeoObj*>(&rAction)
        || dynamic_cast<const SdrUndoMoveObj*>(&rAction)
        || dynamic_cast<const SdrUndoObjSetText*>(&rAction))
    {
        const SdrObject* pShape = static_cast<const SdrUndoObj&>(rAction).GetUndoObject();
        if (!pShape)
            return false;
        // A group, or a shape inside one: an action on the group changes (and stores) all of
        // its members, and a member's action can resize the group, so "different shapes" does
        // not mean untouched. Never out of order.
        if (pShape->IsGroupObject() || pShape->getParentSdrObjectFromSdrObject())
            return false;
        rShapes.insert(pShape);
        return true;
    }

    return false;
}

class OffsetUndoContext final : public SfxUndoContext
{
public:
    explicit OffsetUndoContext(size_t nOffset)
        : m_nOffset(nOffset)
    {
    }
    size_t GetUndoOffset() override { return m_nOffset; }

private:
    size_t m_nOffset;
};
}

UndoManager::UndoManager()
  : mpLinkedUndoManager(nullptr)
{
}

void UndoManager::EnterListAction(const OUString &rComment, const OUString& rRepeatComment, sal_uInt16 nId, ViewShellId nViewShellId)
{
    if( !IsDoing() )
    {
        ClearLinkedRedoActions();
        SdrUndoManager::EnterListAction( rComment, rRepeatComment, nId, nViewShellId );
    }
    else assert(false);
}

void UndoManager::AddUndoAction( std::unique_ptr<SfxUndoAction> pAction, bool bTryMerg /* = false */ )
{
    if( !IsDoing() )
    {
        ClearLinkedRedoActions();
        SdrUndoManager::AddUndoAction( std::move(pAction), bTryMerg );
        if (comphelper::COKit::isActive())
            InvalidateUndoStateInAllViews();
    }
    else assert(false);
}

SfxViewUndoLookup UndoManager::LookupViewUndo(ViewShellId nViewId) const
{
    auto aCanMove = [](const SfxUndoAction& rMine) {
        std::set<const SdrObject*> aMine;
        return lcl_CollectShapes(rMine, aMine);
    };
    auto aIndependent = [](const SfxUndoAction& rMine, const SfxUndoAction& rOther) {
        std::set<const SdrObject*> aMine;
        std::set<const SdrObject*> aOther;
        if (!lcl_CollectShapes(rMine, aMine) || !lcl_CollectShapes(rOther, aOther))
            return false;
        for (const SdrObject* pShape : aOther)
        {
            if (aMine.count(pShape))
                return false;
        }
        return true;
    };
    return SdrUndoManager::LookupViewUndo(nViewId, aCanMove, aIndependent);
}

bool UndoManager::UndoAtOffset(size_t nOffset)
{
    OffsetUndoContext aContext(nOffset);
    return UndoWithContext(aContext);
}

void UndoManager::InvalidateUndoStateInAllViews()
{
    for (SfxViewFrame* pFrame = SfxViewFrame::GetFirst(); pFrame; pFrame = SfxViewFrame::GetNext(*pFrame))
    {
        pFrame->GetBindings().Invalidate(SID_UNDO);
        pFrame->GetBindings().Invalidate(SID_REDO);
    }
}

void UndoManager::SetLinkedUndoManager (SfxUndoManager* pLinkedUndoManager)
{
    mpLinkedUndoManager = pLinkedUndoManager;
}

void UndoManager::ClearLinkedRedoActions()
{
    if (mpLinkedUndoManager != nullptr)
        mpLinkedUndoManager->ClearRedo();
}

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
