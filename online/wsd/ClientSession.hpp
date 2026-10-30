/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4; fill-column: 100 -*- */
/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Client session management in WSD process.
 * Classes: ClientSession
 */

#pragma once

#include <common/Rectangle.hpp>
#include <common/Session.hpp>
#include <common/Uri.hpp>
#include <common/Util.hpp>
#include <wsd/DocumentBroker.hpp>
#include <wsd/SenderQueue.hpp>
#include <wsd/ServerURL.hpp>
#include <wsd/Storage.hpp>

#include <Poco/JSON/Array.h>
#include <Poco/JSON/Object.h>
#include <Poco/SharedPtr.h>
#include <Poco/URI.h>

#include <chrono>
#include <cstdint>
#include <deque>
#include <map>
#include <optional>
#include <string_view>
#include <utility>
#include <vector>

class DocumentBroker;
// wsd/AIChatSession.cpp is only compiled into builds that have an HTTP
// transport for the AI proxy: COOL (!MOBILEAPP), CODA-Q (QTAPP), CODA-M
// (MACOSAPP) and CODA-W (_WIN32). The other MOBILEAPP variants
// (iOS/Android/cowasm) build without it.
#if !MOBILEAPP || defined(QTAPP) || defined(MACOSAPP) || defined(_WIN32)
class AIChatSession;
#endif

/// Represents a session to a COOL client, in the WSD process.
class ClientSession final : public Session
{
#if !MOBILEAPP || defined(QTAPP) || defined(MACOSAPP) || defined(_WIN32)
    friend class AIChatSession;
#endif
public:
    ClientSession(const std::shared_ptr<ProtocolHandlerInterface>& ws, const std::string& id,
                  const std::shared_ptr<DocumentBroker>& docBroker, const Poco::URI& uriPublic,
                  bool isReadOnly, const RequestDetails& requestDetails,
                  const AdditionalFilePocoUris& additionalFileUrisPublic = {});
    void construct();
    virtual ~ClientSession();

    void setReadOnly(bool value = true) override;

    void sendFileMode(bool readOnly, bool editComments, bool manageRedlines);

    void setLockFailed(const std::string& reason);

    /// True while this session is read-only only because its storage lock
    /// failed (as opposed to a session that never had edit rights). Cleared
    /// when an attemptlock retry wins the lock back.
    bool isLockFailed() const { return _isLockFailed; }

    STATE_ENUM(SessionState,
               DETACHED, // initial
               LOADING, // attached to a DocBroker & waiting for load
               LIVE, // Document is loaded & editable or viewable.
               WAIT_DISCONNECT // closed and waiting for Kit's disconnected message
    );

    /// Returns true if this session has loaded a view (i.e. we got status message).
    bool isViewLoaded() const { return _state == SessionState::LIVE; }

    /// returns true if we're waiting for the kit to acknowledge disconnect.
    bool inWaitDisconnected() const { return _state == SessionState::WAIT_DISCONNECT; }

    /// transition to a new state
    void setState(SessionState newState);

    void setDocumentOwner(const bool documentOwner) { _isDocumentOwner = documentOwner; }
    bool isDocumentOwner() const { return _isDocumentOwner; }

    /// Returns true iff the view is loaded and not disconnected
    /// from either the client or the Kit.
    bool isLive() const { return _state == SessionState::LIVE && !isCloseFrame(); }

    /// Handle kit-to-client message.
    bool handleKitToClientMessage(const std::shared_ptr<Message>& payload);

    std::optional<bool>
    handleOpenDocKitToClientMessage(const std::shared_ptr<Message>& payload,
                                    const std::shared_ptr<DocumentBroker>& docBroker,
                                    const std::shared_ptr<StreamSocket>& saveAsSocket);

    /// Vulcan: reads a kit `jsdialog:` frame for this view into
    /// vulcanNoteDialog. Never consumes the frame, and never throws.
    void vulcanReadDialogFrame(const std::string& json);

    /// Integer id of the view in the kit process, or -1 if unknown
    int getKitViewId() const { return _kitViewId; }

    /// Disconnect the session and do final cleanup, @returns true if we should not wait.
    bool disconnectFromKit();

    // sendTextFrame that takes std::string and string literal.
    using Session::sendTextFrame;

    bool sendBinaryFrame(const char* buffer, int length) override
    {
        if (!isCloseFrame())
        {
            enqueueSendMessage(std::make_shared<Message>(buffer, length, Message::Dir::Out));
            return true;
        }

        return false;
    }

    void resetTileSeq(const TileDesc &desc)
    {
        _tracker.resetTileSeq(desc);
    }

    // no tile data - just notify the client the ids/versions updated
    bool sendUpdateNow(const TileDesc &desc)
    {
        TileWireId lastSentId = _tracker.updateTileSeq(desc);
        std::string header = desc.serialize("update:", "\n");
        LOG_TRC("Sending update from " << lastSentId << " to " << header);
        return sendTextFrame(header.data(), header.size());
    }

    bool sendTileNow(const TileDesc &desc, const Tile &tile)
    {
        TileWireId lastSentId = _tracker.updateTileSeq(desc);

        std::string header;
        if (tile->needsKeyframe(lastSentId) || tile->isPng())
            header = desc.serialize("tile:", "\n");
        else
            header = desc.serialize("delta:", "\n");

        // FIXME: performance - optimize away this copy ...
        std::vector<char> output;

        // copy in the header
        output.resize(header.size());
        std::memcpy(output.data(), header.data(), header.size());

        bool hasContent = tile->appendChangesSince(output, tile->isPng() ? 0 : lastSentId);
        LOG_TRC("Sending tile message: " << header << " lastSendId " << lastSentId << " content " << hasContent);
        return sendBinaryFrame(output.data(), output.size());
    }

    bool sendBlob(const std::string &header, const Blob &blob)
    {
        // FIXME: performance - optimize away this copy ...
        std::vector<char> output;

        output.resize(header.size() + blob->size());
        std::memcpy(output.data(), header.data(), header.size());
        std::memcpy(output.data() + header.size(), blob->data(), blob->size());

        return sendBinaryFrame(output.data(), output.size());
    }

    bool sendTextFrame(const char* buffer, const int length) override
    {
        if (!isCloseFrame())
        {
            enqueueSendMessage(std::make_shared<Message>(buffer, length, Message::Dir::Out));
            return true;
        }

        return false;
    }

    void enqueueSendMessage(const std::shared_ptr<Message>& data);

    /// Vulcan: how long roster/cursor fan-out (viewinfo:, cellviewcursor:,
    /// textviewselection:) is coalesced for. 0 - the default - disables
    /// coalescing entirely, so the wire is exactly what upstream sends.
    /// Configured with per_document.view_update_coalesce_ms.
    static std::chrono::milliseconds viewUpdateCoalesceInterval();

    /// True when we are holding back a coalesced roster/cursor update.
    bool hasPendingViewUpdates() const { return !_pendingViewUpdates.empty(); }

    /// Sends the coalesced roster/cursor updates we hold, if the coalescing
    /// interval has elapsed. Called once per document poll iteration.
    void flushCoalescedViewUpdatesIfDue();

    /// Set the save-as socket which is used to send convert-to results.
    void setSaveAsSocket(const std::shared_ptr<StreamSocket>& socket)
    {
        _saveAsSocket = socket;
        _isConvertTo = static_cast<bool>(socket);
    }

    std::shared_ptr<DocumentBroker> getDocumentBroker() const { return _docBroker.lock(); }

    /// Exact URI (including query params - access tokens etc.) with which
    /// client made the request to us
    ///
    /// Note: This URI is unsafe - when connecting to existing sessions, we must
    /// ignore everything but the access_token, and use the access_token with
    /// the URI of the initial request.
    const Poco::URI& getPublicUri() const { return _uriPublic; }

    const AdditionalFilePocoUris& getAdditionalFilePublicUri() const { return _additionalFileUrisPublic; }

    /// Whether the request that opened this session was server-to-server
    /// (RequestDetails::isServerToServer()); validates the storage URI.
    bool isServerToServer() const { return _isServerToServer; }

    /// The access token of this session.
    const Authorization& getAuthorization() const { return _auth; }

    void invalidateAuthorizationToken()
    {
        LOG_DBG("Session [" << getId() << "] expiring its authorization token");
        _auth.expire();
    }

    /// Why a token refresh was asked for.
    ///
    /// Upload and lock requests can share a wait, but need their own retries and
    /// failure handling. A lock-only timeout demotes without reporting a save error.
    enum class TokenRefreshCause
    {
        Upload = 1,
        Lock = 2
    };

    /// Start waiting for a token refresh from the host.
    void startTokenRefresh(const std::chrono::seconds timeout = std::chrono::seconds(30),
                           const TokenRefreshCause cause = TokenRefreshCause::Upload)
    {
        LOG_DBG("Session [" << getId() << "] starting token refresh wait (attempt #"
                            << (_tokenRefreshAttempts + 1) << ')');
        ++_tokenRefreshAttempts;
        _tokenRefreshCauses = static_cast<unsigned>(cause);
        _auth.startTokenRefresh(timeout);
    }

    /// Join an existing wait without spending another attempt or extending its deadline.
    void addTokenRefreshCause(const TokenRefreshCause cause)
    {
        _tokenRefreshCauses |= static_cast<unsigned>(cause);
    }

    bool hasTokenRefreshCause(const TokenRefreshCause cause) const
    {
        return (_tokenRefreshCauses & static_cast<unsigned>(cause)) != 0;
    }

    void clearTokenRefreshCauses() { _tokenRefreshCauses = 0; }

    /// Returns the number of consecutive refresh attempts since the last successful upload.
    int tokenRefreshAttempts() const { return _tokenRefreshAttempts; }

    /// Reset the consecutive token-refresh attempt counter. Call on successful upload.
    void resetTokenRefreshAttempts() { _tokenRefreshAttempts = 0; }

    /// Returns true iff this session is waiting for a token refresh.
    bool isRefreshingToken() const { return _auth.isRefreshingToken(); }

    /// Returns true if the token refresh wait has timed out.
    bool isTokenRefreshTimedOut(
        const std::chrono::steady_clock::time_point now = std::chrono::steady_clock::now()) const
    {
        return _auth.isTokenRefreshTimedOut(now);
    }

    /// Set WOPI fileinfo object
    void setWopiFileInfo(std::unique_ptr<WopiStorage::WOPIFileInfo> wopiFileInfo) { _wopiFileInfo = std::move(wopiFileInfo); }

    /// True if the WOPI host asked for AI UI / features to be disabled for this document.
    bool isDisableAISettings() const;

    /// Get requested tiles waiting for sending to the client
    std::deque<TileDesc>& getRequestedTiles() { return _requestedTiles; }

    /// Mark a new tile as sent
    void addTileOnFly(TileWireId wireId);
    size_t getTilesOnFlyCount() const { return _tilesOnFly.size(); }
    size_t getTilesOnFlyUpperLimit() const;
    void removeOutdatedTilesOnFly(std::chrono::steady_clock::time_point now);
    void onTileProcessed(TileWireId wireId);
    /// Remove a tile from the on-fly tracking (no logging if absent).
    /// Returns true if the wireId was found and removed.
    bool removeTileOnFly(TileWireId wireId);

    const Util::Rectangle& getVisibleArea() const { return _clientVisibleArea; }
    /// Visible area can have negative value as position, but we have tiles only in the positive range
    Util::Rectangle getNormalizedVisibleArea() const;

    /// The client's visible area can be divided into a maximum of 4 panes.
    enum SplitPaneName : std::uint8_t
    {
        TOPLEFT_PANE,
        TOPRIGHT_PANE,
        BOTTOMLEFT_PANE,
        BOTTOMRIGHT_PANE
    };

    /// Returns true if the given split-pane is currently valid.
    bool isSplitPane(SplitPaneName) const;

    /// Returns the normalized visible area of a given split-pane.
    Util::Rectangle getNormalizedVisiblePaneArea(SplitPaneName) const;

    int getTileWidthInTwips() const { return _tileWidthTwips; }
    int getTileHeightInTwips() const { return _tileHeightTwips; }

    bool isTextDocument() const { return _isTextDocument; }

    bool isSpreadsheetDocument() const { return _isSpreadsheetDocument; }

    /// Vulcan: wsd sent this view a `.uno:AcceptFormula notify=1` of its own
    /// (DocumentBroker::vulcanCommitInProgressInput), whose result the client
    /// never asked for.
    void vulcanExpectCommitResult() { ++_vulcanCommitResultsOwed; }

    /// Vulcan: an `.uno:AcceptFormula` result is one of wsd's own (and is
    /// swallowed) while any are still owed.
    bool vulcanTakeCommitResult()
    {
        if (_vulcanCommitResultsOwed == 0)
            return false;
        --_vulcanCommitResultsOwed;
        return true;
    }

    /// Vulcan: the modeless dialogs core has open in this view, by
    /// LOK window id, with the dialog's id (its .ui id, such as FormulaDialog),
    /// from the kit's jsdialog frames: a dialog's full frame (no action) of type
    /// modelessdialog adds it, its close frame removes it.
    /// Calc's reference dialogs (the Function Wizard, Manage Names, Conditional
    /// Formatting, the filters, ...) are modeless and lock this view's
    /// SfxDispatcher, so core refuses every .uno:Save sent through this view
    /// while one is open (anyrefdg.cxx, dispatch.cxx). Modal dialogs and message
    /// boxes do not lock it, and are not tracked, except Data > Validity
    /// (ValidationDialog): modal, but its range picker (Allow: Cell range, then
    /// the Source field) enters reference mode, which locks the view the same
    /// way (ScValidationDlg::SetupRefDlg, ScRefHandler::EnterRefMode). Its full
    /// frame keeps the type it opened with, so it is tracked by its id.
    void vulcanNoteDialog(std::string_view jsontype, std::string_view action,
                          std::string_view type, std::string_view dialogId, std::uint64_t id)
    {
        if (jsontype != "dialog")
            return;
        // The dialog's own close frame carries no type. A popup's close
        // (type modalpopup) is not the dialog closing.
        if (action == "close" && type.empty())
            _vulcanModelessDialogs.erase(id);
        else if (action.empty() && (type == "modelessdialog" || dialogId == "ValidationDialog"))
            _vulcanModelessDialogs[id] = std::string(dialogId);
    }

    /// Vulcan: a save sent through this view may be refused, because
    /// a modeless dialog is open in a spreadsheet view (vulcanNoteDialog).
    bool vulcanSaveBlockedByDialog() const
    {
        return isSpreadsheetDocument() && !_vulcanModelessDialogs.empty();
    }

    /// Vulcan: a dialog open in this spreadsheet view committed the
    /// view's cell when it opened (vulcanDialogCommitsInputAtOpen), so a final
    /// write that closes it has no cell of this view left to commit, and keeps
    /// the edit open (DocumentBroker::sendUnoSave). Find & Replace, Hyperlink,
    /// Spelling and any dialog not listed there do not commit it: the view may
    /// still hold a half-typed cell, which that save commits as before.
    bool vulcanInputCommittedByDialog() const
    {
        if (!isSpreadsheetDocument())
            return false;
        for (const auto& dialog : _vulcanModelessDialogs)
            if (vulcanDialogCommitsInputAtOpen(dialog.second))
                return true;
        return false;
    }

    /// Vulcan: the dialogs that end their view's cell edit as they
    /// open: the Function Wizard (ScFormulaDlg's constructor runs
    /// InputEnterHandler, sc/source/ui/formdlg/formula.cxx), and every Calc
    /// reference dialog (ScAnyRefDlgController, whose ScRefHandler::EnterRefMode
    /// runs it, sc/source/ui/miscdlgs/anyrefdg.cxx); the ids are their .ui ids
    /// in engine/sc/source/ui. The wizard then marks the view's input line
    /// modified while it still holds the text last entered in the view, so a
    /// save that ends the edit after wsd closes the wizard (its Cancel is only
    /// posted) stores that text into the cell under it.
    static bool vulcanDialogCommitsInputAtOpen(std::string_view dialogId)
    {
        if (dialogId == "FormulaDialog")
            return true;
        static constexpr std::string_view referenceDialogs[] = {
            "AdvancedFilterDialog", "AnalysisOfVarianceDialog", "ChiSquareTestDialog",
            "CondFormatEasyDlg", "ConditionalFormatDialog", "ConsolidateDialog",
            "CorrelationDialog", "CovarianceDialog", "DefineDatabaseRangeDialog",
            "DefineNameDialog", "DescriptiveStatisticsDialog", "ExponentialSmoothingDialog",
            "FourierAnalysisDialog", "GoalSeekDialog", "ManageNamesDialog",
            "MovingAverageDialog", "MultipleOperationsDialog", "NameRangesDialog",
            "PivotTableLayout", "PrintAreasDialog", "RandomNumberGeneratorDialog",
            "RegressionDialog", "SamplingDialog", "ShowChangesDialog", "SimpleRefDialog",
            "SolverDialog", "SparklineDataRangeDialog", "SparklineDialog",
            "StandardFilterDialog", "TTestDialog", "XMLSourceDialog", "ZTestDialog",
            "tablerangedialog",
        };
        for (const std::string_view referenceDialog : referenceDialogs)
            if (dialogId == referenceDialog)
                return true;
        return false;
    }

    const std::map<std::uint64_t, std::string>& vulcanModelessDialogs() const
    {
        return _vulcanModelessDialogs;
    }

    /// Vulcan: the host marks headless agent views with
    /// UserExtraInfo.vulcan_agent in CheckFileInfo. Such views drive the
    /// document without a canvas, so they are excluded from the tile-cache
    /// budget. Defaults to false, i.e. an ordinary user view.
    void setVulcanAgentView(bool isAgent) { _isVulcanAgentView = isAgent; }
    bool isVulcanAgentView() const { return _isVulcanAgentView; }

    void setThumbnailSession(const bool val) { _thumbnailSession = val; }

    void setThumbnailTarget(const std::string& target) { _thumbnailTarget = target; }

    const std::string& getThumbnailTarget() const { return _thumbnailTarget; }

    void setThumbnailPosition(const std::pair<int, int>& pos) { _thumbnailPosition = pos; }

    const std::pair<int, int>& getThumbnailPosition() const { return _thumbnailPosition; }

    bool thumbnailSession() const { return _thumbnailSession; }

    /// Do we recognize this clipboard ?
    bool matchesClipboardKeys(const std::string &viewId, const std::string &tag);

    /// Handle presentation info request
    bool handlePresentationInfo(const std::shared_ptr<Message>& payload, const std::shared_ptr<DocumentBroker>& docBroker);

    /// Handle a clipboard fetch / put request.
    void handleClipboardRequest(DocumentBroker::ClipboardRequest     type,
                                const std::shared_ptr<StreamSocket> &socket,
                                const std::string                   &tag,
                                const std::string                   &clipFile);

    /// Create URI for transient clipboard content.
    std::string getClipboardURI(bool encode = true);

    /// Utility to create a publicly accessible URI.
    std::string createPublicURI(const std::string& subPath, const std::string& tag, bool encode);

    /// Adds and/or modified the copied payload before sending on to the client.
    void postProcessCopyPayload(const std::shared_ptr<Message>& payload);
    bool postProcessCopyPayload(std::istream&, std::ostream&);

    /// Removes the <meta name="origin" ...> tag which was added in
    /// ClientSession::postProcessCopyPayload().
    bool preProcessSetClipboardPayload(std::istream&, std::ostream&);

    /// Returns true if we're expired waiting for a clipboard and should be removed
    bool staleWaitDisconnect(std::chrono::steady_clock::time_point now);

    /// Generate and rotate a new clipboard hash, sending it if appropriate
    void rotateClipboardKey(bool notifyClient);

    /// Generate an access token for this session via proxy protocol.
    const std::string &getOrCreateProxyAccess();

#if ENABLE_FEATURE_LOCK
    void sendLockedInfo();
#endif

#if ENABLE_FEATURE_RESTRICTION
    void sendRestrictionInfo();
#endif

    /// Process an SVG to replace embedded file:/// media URIs with public http URLs.
    std::string processSVGContent(const std::string& svg);

    CanonicalViewId getCanonicalViewId() const { return _canonicalViewId; }

    bool getSentBrowserSetting() const { return _sentBrowserSetting; }

    void setSentBrowserSetting(const bool sentBrowserSetting)
    {
        _sentBrowserSetting = sentBrowserSetting;
    }

    void setBrowserSettingsJSON(const Poco::SharedPtr<Poco::JSON::Object>& jsonObject)
    {
        _browserSettingsJSON = jsonObject;
    }

    Poco::SharedPtr<Poco::JSON::Object> getBrowserSettingJSON() const
    {
        return _browserSettingsJSON;
    }

    void uploadBrowserSettingsToWopiHost();

    void setViewSettingsJSON(const Poco::SharedPtr<Poco::JSON::Object>& jsonObject)
    {
        _viewSettingsJSON = jsonObject;
    }

    Poco::SharedPtr<Poco::JSON::Object> getViewSettingsJSON() const
    {
        return _viewSettingsJSON;
    }

    void uploadViewSettingsToWopiHost();

    /// Resolve AI credentials with precedence:
    ///   viewSettings[aiProviderAPIKey|Model|URL]
    ///   -> userPrivateInfoObj[AIProviderAPIKey|Model|URL]
    ///   -> coolwsd.xml ai.api_key / ai.model / ai.api_url
    /// When ai.allow_user_settings is false the per-user sources are skipped
    /// and only the coolwsd.xml values are used, locking every user to the
    /// central endpoint.
    /// Applies the resolved values to this session. If viewSettings is non-null
    /// and a field is filled from userPrivateInfoObj, viewSettings is mutated
    /// (and viewSettingsMutated set to true) so callers can persist the
    /// migration. outModel receives the resolved model name when aiConfigured,
    /// otherwise an empty string. outRating receives the ethical AI rating
    /// (A/B/C/U).
    /// Returns aiConfigured: ai.enabled AND all three fields non-empty.
    bool resolveAndApplyAICredentials(
        Poco::JSON::Object::Ptr& viewSettings,
        const Poco::JSON::Object::Ptr& userPrivateInfoObj,
        bool disableAISettings,
        bool& viewSettingsMutated,
        std::string& outModel,
        std::string& outRating);

    /// Resolve AI image-generation credentials with the same precedence as
    /// resolveAndApplyAICredentials:
    ///   viewSettings[aiImageProviderAPIKey|URL|aiImageModel|aiImageSize]
    ///   -> userPrivateInfoObj[AIImageProviderAPIKey|URL|AIImageModel|AIImageSize]
    ///   -> coolwsd.xml ai.image_api_key / ai.image_api_url / ai.image_model / ai.image_size
    /// As with resolveAndApplyAICredentials, ai.allow_user_settings=false skips
    /// the per-user sources and uses only the coolwsd.xml values.
    /// Applies the resolved values to this session. If viewSettings is non-null
    /// and a field is filled from userPrivateInfoObj, viewSettings is mutated
    /// (and viewSettingsMutated set to true) so callers can persist the
    /// migration.
    void resolveAndApplyAIImageCredentials(Poco::JSON::Object::Ptr& viewSettings,
                                           const Poco::JSON::Object::Ptr& userPrivateInfoObj,
                                           bool& viewSettingsMutated);

    /// Override parsedDocOption values we get from browser setting json
    /// Because when client sends `load url` it doesn't have information about browser setting json
    void overrideDocOption();

#if !MOBILEAPP
    void updateBrowserSettingsJSON(const std::string& json);
#endif

private:
    std::shared_ptr<ClientSession> client_from_this()
    {
        return std::static_pointer_cast<ClientSession>(shared_from_this());
    }

    /// SocketHandler: disconnection event.
    void onDisconnect() override;

    /// Does SocketHandler: have messages to send ?
    bool hasQueuedMessages() const override { return !_senderQueue.empty(); }

    /// SocketHandler: send those messages
    void writeQueuedMessages(std::size_t capacity) override;

    virtual bool _handleInput(const char* buffer, int length) override;

    bool handleSignatureAction(const StringVector& tokens);

    bool handleUpdateViewSettings(const std::string& firstLine);

    /// Put back the secrets the browser asked to keep. A secret the user did not
    /// change arrives with an empty value and a "<field>Stored": true flag; this
    /// replaces it with the value the session already holds (or the stored
    /// settings) and removes the flag, so applying the update does not wipe it.
    void restoreKeptViewSettingSecrets(Poco::JSON::Object::Ptr& viewSettings);

    /// Persist the last-used Impress view mode (Normal/Notes) for the current
    /// document, keyed by docKey, inside the per-user viewsetting.json. The
    /// per-user dimension is implicit in where that file lives; we only add the
    /// per-document key here.
    bool handleUpdateViewMode(const StringVector& tokens);

    bool loadDocument(const char* buffer, int length, const StringVector& tokens,
                      const std::shared_ptr<DocumentBroker>& docBroker);
    /// The global accessibility switch also changes the stock desktop UI mode,
    /// so phone sessions opt into the per-view protocol without enabling that
    /// deployment-wide switch.
    bool canUseAccessibility() const;
    bool getStatus(const char* buffer, int length,
                   const std::shared_ptr<DocumentBroker>& docBroker);
    bool getCommandValues(const char* buffer, int length, const StringVector& tokens,
                          const std::shared_ptr<DocumentBroker>& docBroker);
    /// Command values can be localized (style names), so views of one document
    /// in different languages must not share a cached entry.
    std::string commandValuesCacheKey(const std::string& command) const
    {
        return command + " lang=" + getLang();
    }
    bool sendTile(const char* buffer, int length, const StringVector& tokens,
                  const std::shared_ptr<DocumentBroker>& docBroker);
    bool sendCombinedTiles(const char* buffer, int length, const StringVector& tokens,
                           const std::shared_ptr<DocumentBroker>& docBroker);

    bool handleGetSlideRequest(const StringVector& tokens,
                               const std::shared_ptr<DocumentBroker>& docBroker);

    bool forwardToChild(const std::string& message,
                        const std::shared_ptr<DocumentBroker>& docBroker);

    bool forwardToClient(const std::shared_ptr<Message>& payload);

    /// Vulcan: roster/cursor coalescing (see viewUpdateCoalesceInterval()).
    /// Decides what to do with a message on its way to this client:
    /// - returns false for anything we are not coalescing, or that may go out
    ///   right away, in which case the caller sends it as usual. Anything held
    ///   back is flushed first, so the client's message order never changes;
    /// - returns true when the message was buffered to be sent later, replacing
    ///   any older update of the same kind for the same view.
    bool coalesceViewUpdate(const std::shared_ptr<Message>& payload);

    /// Enqueues every coalesced update we hold, in arrival order.
    void flushCoalescedViewUpdates(std::chrono::steady_clock::time_point now);

    /// Returns true if given message from the client should be allowed or not
    /// Eg. in readonly mode only few messages should be allowed
    bool filterMessage(const std::string& msg) const;

    /// Returns true if the download message of type 'id' should be allowed or not
    bool filterDownloadAs(const std::string& id) const;

    void dumpState(std::ostream& os) override;

    /// Handle invalidation message coming from a kit and transfer it to a tile request.
    void handleTileInvalidation(const std::string& message,
                                const std::shared_ptr<DocumentBroker>& docBroker);

    bool isTileInsideVisibleArea(const TileDesc& tile) const;

    /// If this session is read-only because of failed lock, try to unlock and make it read-write.
    bool attemptLock(const std::shared_ptr<DocumentBroker>& docBroker);

    std::string getIsAdminUserStatus() const;

    /// Abort conversion due to failure.
    void abortConversion(const std::shared_ptr<DocumentBroker>& docBroker,
                         const std::shared_ptr<StreamSocket>& saveAsSocket, std::string errorKind);

#if !MOBILEAPP

    /// Handles saveas: and exportas: in handleKitToClientMessage.
    bool handleSaveAs(const std::shared_ptr<Message>& payload,
                      const std::shared_ptr<DocumentBroker>& docBroker,
                      const std::shared_ptr<StreamSocket>& saveAsSocket);
#endif // !MOBILEAPP

private:
    /// URI with which client made request to us
    const Poco::URI _uriPublic;

    const AdditionalFilePocoUris _additionalFileUrisPublic;

    SenderQueue<std::shared_ptr<Message>> _senderQueue;

    /// Requested tiles are stored in this list, before we can send them to the client
    std::deque<TileDesc> _requestedTiles;

    /// How to find our service from the client.
    const ServerURL _serverURL;

    /// See isServerToServer().
    const bool _isServerToServer;

    /// Authorization data - either access_token or access_header.
    Authorization _auth;

    /// Number of consecutive token-refresh attempts triggered by upload or lock 401s
    /// since the last successful upload. Bounds the refresh-on-unauthorize retry loop.
    int _tokenRefreshAttempts;

    /// Both lanes may share one in-flight token refresh. See TokenRefreshCause.
    unsigned _tokenRefreshCauses = 0;

    /// Rotating clipboard remote access identifiers - protected by GlobalSessionMapMutex
    std::string _clipboardKeys[2];

    /// Target used for thumbnail rendering
    std::string _thumbnailTarget;

    /// Secure session id token for proxyprotocol authentication
    std::string _proxyAccess;

    /// Store last sent payload of form field button, so we can filter out redundant messages.
    std::string _lastSentFormFielButtonMessage;

    std::weak_ptr<DocumentBroker> _docBroker;

    /// The socket to which the converted (saveas) doc is sent.
    std::weak_ptr<StreamSocket> _saveAsSocket;

    /// Time of last state transition
    std::chrono::steady_clock::time_point _lastStateTime;

    /// Wopi FileInfo object
    std::unique_ptr<WopiStorage::WOPIFileInfo> _wopiFileInfo;

    /// wire-ids's of the in-flight tiles. Push by sending and pop by tileprocessed message from the client.
    std::vector<std::pair<TileWireId, std::chrono::steady_clock::time_point>> _tilesOnFly;

    /// Sockets to send binary selection content to
    std::vector<std::weak_ptr<StreamSocket>> _clipSockets;

    /// Delta tile tracker.
    ClientDeltaTracker _tracker;

    /// Visible area of the client
    Util::Rectangle _clientVisibleArea;

    Poco::SharedPtr<Poco::JSON::Object> _browserSettingsJSON;

    /// Time when loading of view started
    std::chrono::steady_clock::time_point _viewLoadStart;

    /// Count of key-strokes
    uint64_t _keyEvents;

    /// Epoch of the client's performance.now() function, as microseconds since Unix epoch
    uint64_t _performanceCounterEpoch;

    /// Split position that defines the current split panes
    int _splitX;
    int _splitY;

    /// Selected part of the document viewed by the client (no parts in Writer)
    int _clientSelectedPart;

    /// Selected mode of the presentation viewed by the client (in Impress)
    int _clientSelectedMode;

    /// Zoom properties of the client
    int _tileWidthPixel;
    int _tileHeightPixel;
    int _tileWidthTwips;
    int _tileHeightTwips;

    /// The integer id of the view in the Kit process
    int _kitViewId;

    /// the canonical id unique to the set of rendering properties of this session
    CanonicalViewId _canonicalViewId;

    // Position used for thumbnail rendering
    std::pair<int, int> _thumbnailPosition;

    /// The phase of our lifecycle that we're in.
    SessionState _state;

    /// Whether this session is the owner of currently opened document
    bool _isDocumentOwner;

    /// If it is allowed to try to switch from read-only to edit mode,
    /// because it's read-only just because of transient lock failure.
    bool _isLockFailed = false;

    /// Vulcan: setLockFailed demoted a full editor (not a comment-only or
    /// redline session), so a won attemptlock must undo exactly that.
    bool _lockFailedDemotedEditor = false;
    /// Vulcan: setLockFailed pushed this session's Core view read-only, so a
    /// won attemptlock must lift it again (and only then).
    bool _lockFailedViewReadOnly = false;
    /// Vulcan: the comment and redline rights setLockFailed took away.
    bool _lockFailedSavedComments = false;
    bool _lockFailedSavedRedlines = false;

    /// Client is using a text document?
    bool _isTextDocument;

    /// Vulcan: client is using a spreadsheet (the status: type), whose
    /// in-progress cell a going-away save commits first
    /// (DocumentBroker::vulcanCommitInProgressInput).
    bool _isSpreadsheetDocument = false;

    /// Vulcan: wsd's own `.uno:AcceptFormula` results still to come
    /// (vulcanExpectCommitResult).
    std::size_t _vulcanCommitResultsOwed = 0;

    /// Vulcan: the modeless dialogs open in this view, by LOK window
    /// id, with the dialog's id (vulcanNoteDialog).
    std::map<std::uint64_t, std::string> _vulcanModelessDialogs;

    /// Session used to generate thumbnail
    bool _thumbnailSession;

    /// Vulcan: headless agent view (UserExtraInfo.vulcan_agent), see
    /// isVulcanAgentView().
    bool _isVulcanAgentView = false;

    /// Vulcan: roster/cursor updates held back for coalescing, in arrival order,
    /// each keyed by "<kind>|<viewId>" so a newer update of the same kind for the
    /// same view supersedes the one we still hold. Always empty unless
    /// per_document.view_update_coalesce_ms is set.
    std::vector<std::pair<std::string, std::shared_ptr<Message>>> _pendingViewUpdates;

    /// Vulcan: when we last let a roster/cursor update through to this client.
    std::chrono::steady_clock::time_point _lastViewUpdateFlush;

    // Saves time from setting/fetching user info multiple times using zotero API
    bool _isZoteroUserInfoSet = false;

    /// If server audit was already sent
    bool _sentAudit;

    /// If browser setting was already sent
    bool _sentBrowserSetting;

    /// If Session is for convert-to
    bool _isConvertTo;

    Poco::SharedPtr<Poco::JSON::Object> _viewSettingsJSON;

#if !MOBILEAPP || defined(QTAPP) || defined(MACOSAPP) || defined(_WIN32)
    /// AI chat orchestrator - multi-round LLM tool loop.
    std::unique_ptr<AIChatSession> _aiChat;
#endif
};

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
