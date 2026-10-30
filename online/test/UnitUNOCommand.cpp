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
 * Unit test for UNO command execution functionality.
 */

#include <config.h>

#include <algorithm>
#include <map>
#include <memory>
#include <ostream>
#include <set>
#include <string>

#include <Poco/Exception.h>
#include <regex>
#include <Poco/URI.h>
#include <test/lokassert.hpp>

#include <Unit.hpp>
#include <helpers.hpp>
#include <wsd/COOLWSD.hpp>

namespace
{
void testStateChanged(const std::string& filename, std::set<std::string>& commands,
                      const std::map<std::string, std::string>& exactPayloads = {})
{
    const auto testname = "stateChanged_" + filename + ' ';

    std::regex reUno("\\.[a-zA-Z]*\\:[a-zA-Z]*\\=");
    std::set<std::string> exactPayloadCommandsSeen;
    std::set<std::string> exactPayloadsMatched;

    const auto recordState = [&](const std::string& commandName, const std::string& state)
    {
        commands.erase(commandName + "=");

        const auto exactPayload = exactPayloads.find(commandName);
        if (exactPayload != exactPayloads.end())
        {
            exactPayloadCommandsSeen.insert(commandName);
            if (state == exactPayload->second)
                exactPayloadsMatched.insert(commandName);
        }
    };

    std::shared_ptr<SocketPoll> socketPoll = std::make_shared<SocketPoll>("UnitEachView");
    socketPoll->startThread();

    std::shared_ptr<http::WebSocketSession> socket = helpers::loadDocAndGetSession(
        socketPoll, filename, Poco::URI(helpers::getTestServerURI()), testname);
    helpers::SocketProcessor(testname, socket,
        [&](const std::string& msg)
        {
            if (msg.starts_with("statechanged: {"))
            {
                // Payload is JSON, the commandName key has the command name.
                Poco::JSON::Parser parser;
                std::string json = msg.substr(strlen("statechanged: "));
                const Poco::Dynamic::Var var = parser.parse(json);
                const auto& root = var.extract<Poco::JSON::Object::Ptr>();
                std::string commandName = root->get("commandName").toString();
                const std::string state =
                    root->has("state") ? root->get("state").toString() : std::string();
                recordState(commandName, state);
            }
            else
            {
                std::smatch matches;
                if (std::regex_search(msg, matches, reUno))
                {
                    // Payload is a commandName=...status... plain text format.
                    const std::string commandPrefix = matches[0].str();
                    const std::string commandName =
                        commandPrefix.substr(0, commandPrefix.size() - 1);
                    const std::string state = msg.substr(matches.position() + matches.length());
                    recordState(commandName, state);
                }
            }

            return !commands.empty() || exactPayloadsMatched.size() != exactPayloads.size();
        });

    const bool hasWrongExactPayload =
        std::any_of(exactPayloads.begin(), exactPayloads.end(), [&](const auto& exactPayload)
        {
            return exactPayloadCommandsSeen.contains(exactPayload.first) &&
                   !exactPayloadsMatched.contains(exactPayload.first);
        });

    if (!commands.empty() || hasWrongExactPayload)
    {
        std::ostringstream ostr;
        if (!commands.empty())
        {
            ostr << filename << " : Missing Uno Commands: " << std::endl;
            for (const auto& itUno : commands)
                ostr << itUno << std::endl;
        }

        for (const auto& [commandName, expectedPayload] : exactPayloads)
        {
            if (exactPayloadCommandsSeen.contains(commandName) &&
                !exactPayloadsMatched.contains(commandName))
            {
                ostr << filename << " : Wrong Uno Command payload: " << commandName
                     << " expected " << expectedPayload << std::endl;
            }
        }

        LOK_ASSERT_FAIL(ostr.str());
    }
}
}

/// Test suite for UNO commands.
class UnitUNOCommand : public UnitWSD
{
    TestResult testStateUnoCommandWriter();
    TestResult testStateUnoCommandCalc();
    TestResult testStateUnoCommandImpress();

public:
    UnitUNOCommand()
        : UnitWSD("UnitUNOCommand")
    {
    }

    void configure(Poco::Util::LayeredConfiguration& config) override
    {
        UnitWSD::configure(config);
        // The notebookbar binds NumberFormatType by itself, masking whether
        // doc_iniUnoCommands registered it for a headless/classic client.
        config.setString("user_interface.mode", "classic");
        COOLWSD::UserInterface = "classic";
    }

    void invokeWSDTest() override;
};

UnitBase::TestResult UnitUNOCommand::testStateUnoCommandWriter()
{
    std::set<std::string> writerCommands
    {
        ".uno:BackgroundColor=",
        ".uno:Bold=",
        ".uno:CenterPara=",
        ".uno:CharBackColor=",
        ".uno:CharBackgroundExt=",
        ".uno:CharFontName=",
        ".uno:Color=",
        ".uno:DefaultBullet=",
        ".uno:DefaultNumbering=",
        ".uno:FontColor=",
        ".uno:FontHeight=",
        ".uno:Italic=",
        ".uno:JustifyPara=",
        ".uno:OutlineFont=",
        ".uno:LeftPara=",
        ".uno:RightPara=",
        ".uno:Shadowed=",
        ".uno:SubScript=",
        ".uno:SuperScript=",
        ".uno:Strikeout=",
        ".uno:StyleApply=",
        ".uno:Underline=",
        ".uno:ModifiedStatus=",
        ".uno:Undo=",
        ".uno:Redo=",
        ".uno:Cut=",
        ".uno:Copy=",
        ".uno:Paste=",
        ".uno:SelectAll=",
        ".uno:InsertAnnotation=",
        ".uno:InsertRowsBefore=",
        ".uno:InsertRowsAfter=",
        ".uno:InsertColumnsBefore=",
        ".uno:InsertColumnsAfter=",
        ".uno:DeleteRows=",
        ".uno:DeleteColumns=",
        ".uno:DeleteTable=",
        ".uno:SelectTable=",
        ".uno:EntireRow=",
        ".uno:EntireColumn=",
        ".uno:EntireCell=",
        ".uno:InsertMode=",
        ".uno:StateTableCell=",
        ".uno:StatePageNumber=",
        ".uno:StateWordCount=",
        ".uno:SelectionMode=",
        ".uno:NumberFormatCurrency=",
        ".uno:NumberFormatPercent=",
        ".uno:NumberFormatDate="
    };

    try
    {
        testStateChanged("empty.odt", writerCommands);
    }
    catch (const Poco::Exception& exc)
    {
        LOK_ASSERT_FAIL(exc.displayText());
    }
    return TestResult::Ok;
}

UnitBase::TestResult UnitUNOCommand::testStateUnoCommandCalc()
{
    std::set<std::string> calcCommands
    {
        ".uno:AlignLeft=",
        ".uno:AlignHorizontalCenter=",
        ".uno:AlignRight=",
        ".uno:AlignTop=",
        ".uno:AlignVCenter=",
        ".uno:AlignBottom=",
        ".uno:BackgroundColor=",
        ".uno:Bold=",
        ".uno:CenterPara=",
        ".uno:CharBackColor=",
        ".uno:CharFontName=",
        ".uno:Color=",
        ".uno:FontHeight=",
        ".uno:Italic=",
        ".uno:JustifyPara=",
        ".uno:OutlineFont=",
        ".uno:LeftPara=",
        ".uno:RightPara=",
        ".uno:Shadowed=",
        ".uno:SubScript=",
        ".uno:SuperScript=",
        ".uno:Strikeout=",
        ".uno:StyleApply=",
        ".uno:Underline=",
        ".uno:ModifiedStatus=",
        ".uno:Undo=",
        ".uno:Redo=",
        ".uno:Cut=",
        ".uno:Copy=",
        ".uno:Paste=",
        ".uno:SelectAll=",
        ".uno:InsertAnnotation=",
        ".uno:InsertRowsBefore=",
        ".uno:InsertRowsAfter=",
        ".uno:InsertColumnsBefore=",
        ".uno:InsertColumnsAfter=",
        ".uno:DeleteRows=",
        ".uno:DeleteColumns=",
        ".uno:StatusDocPos=",
        ".uno:RowColSelCount=",
        ".uno:StatusPageStyle=",
        ".uno:InsertMode=",
        ".uno:StatusSelectionMode=",
        ".uno:StateTableCell=",
        ".uno:StatusBarFunc=",
        ".uno:WrapText=",
        ".uno:ToggleMergeCells=",
        ".uno:NumberFormatCurrency=",
        ".uno:NumberFormatPercent=",
        ".uno:NumberFormatDate=",
        ".uno:NumberFormatType="
    };

    try
    {
        const std::map<std::string, std::string> calcAlignmentPayloads
        {
            { ".uno:AlignLeft", "false" },
            { ".uno:AlignHorizontalCenter", "false" },
            { ".uno:AlignRight", "false" },
            { ".uno:AlignTop", "false" },
            { ".uno:AlignVCenter", "false" },
            { ".uno:AlignBottom", "false" },
        };
        testStateChanged("empty.ods", calcCommands, calcAlignmentPayloads);
    }
    catch (const Poco::Exception& exc)
    {
        LOK_ASSERT_FAIL(exc.displayText());
    }
    return TestResult::Ok;
}

UnitBase::TestResult UnitUNOCommand::testStateUnoCommandImpress()
{
    std::set<std::string> impressCommands
    {
        ".uno:Bold=",
        ".uno:CenterPara=",
        ".uno:CharBackColor=",
        ".uno:CharFontName=",
        ".uno:Color=",
        ".uno:DefaultBullet=",
        ".uno:DefaultNumbering=",
        ".uno:FontHeight=",
        ".uno:Italic=",
        ".uno:JustifyPara=",
        ".uno:OutlineFont=",
        ".uno:LeftPara=",
        ".uno:RightPara=",
        ".uno:Shadowed=",
        ".uno:SubScript=",
        ".uno:SuperScript=",
        ".uno:Strikeout=",
        ".uno:StyleApply=",
        ".uno:Underline=",
        ".uno:ModifiedStatus=",
        ".uno:Undo=",
        ".uno:Redo=",
        ".uno:InsertPage=",
        ".uno:DeletePage=",
        ".uno:DuplicatePage=",
        ".uno:Cut=",
        ".uno:Copy=",
        ".uno:Paste=",
        ".uno:SelectAll=",
        ".uno:InsertAnnotation=",
        ".uno:InsertRowsBefore=",
        ".uno:InsertRowsAfter=",
        ".uno:InsertColumnsBefore=",
        ".uno:InsertColumnsAfter=",
        ".uno:DeleteRows=",
        ".uno:DeleteColumns=",
        ".uno:SelectTable=",
        ".uno:EntireRow=",
        ".uno:EntireColumn=",
        ".uno:AssignLayout=",
        ".uno:PageStatus=",
        ".uno:LayoutStatus=",
        ".uno:Context=",
        ".uno:InsertSymbol=",
    };

    try
    {
        testStateChanged("empty.odp", impressCommands);
    }
    catch (const Poco::Exception& exc)
    {
        LOK_ASSERT_FAIL(exc.displayText());
    }
    return TestResult::Ok;
}

void UnitUNOCommand::invokeWSDTest()
{
    UnitBase::TestResult result = testStateUnoCommandWriter();
    if (result != TestResult::Ok)
        exitTest(result);

    result = testStateUnoCommandCalc();
    if (result != TestResult::Ok)
        exitTest(result);

    result = testStateUnoCommandImpress();
    if (result != TestResult::Ok)
        exitTest(result);

    exitTest(TestResult::Ok);
}

UnitBase* unit_create_wsd(void) { return new UnitUNOCommand(); }

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
