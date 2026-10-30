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

#include <config.h>

#include <HostUtil.hpp>

#include <common/ConfigUtil.hpp>
#include <test/lokassert.hpp>

#include <Poco/URI.h>
#include <Poco/Util/LayeredConfiguration.h>
#include <Poco/Util/MapConfiguration.h>

#include <cppunit/extensions/HelperMacros.h>

/// HostUtilTests unit-tests.
class HostUtilTests : public CPPUNIT_NS::TestFixture
{
    CPPUNIT_TEST_SUITE(HostUtilTests);

    CPPUNIT_TEST(testParseAlias);
    CPPUNIT_TEST(testFirstHostTrustedOnlyInFirstMode);
    CPPUNIT_TEST(testInternalAliasGroupServesServerToServerOnly);
    CPPUNIT_TEST(testSecondaryGroupsInternalOff);
    CPPUNIT_TEST(testNonPublicAddress);

    CPPUNIT_TEST_SUITE_END();

    void testParseAlias();
    void testFirstHostTrustedOnlyInFirstMode();
    void testInternalAliasGroupServesServerToServerOnly();
    void testSecondaryGroupsInternalOff();
    void testNonPublicAddress();

public:
    /// Clear the parsed host state, matching the empty state it starts with, and
    /// set whether WOPI is enabled.
    static void resetHostState(bool wopiEnabled);
};

namespace
{
/// Install a config for the duration of a test and put the previous config, plus
/// an empty and WOPI-disabled host state, back when the scope ends.
class ScopedHostConfig
{
public:
    explicit ScopedHostConfig(const Poco::Util::AbstractConfiguration* config)
        : _previous(ConfigUtil::setConfigForTest(config))
    {
    }

    ~ScopedHostConfig()
    {
        ConfigUtil::setConfigForTest(_previous);
        HostUtilTests::resetHostState(false);
    }

private:
    const Poco::Util::AbstractConfiguration* _previous;
};

/// The WOPI host config terraform gives the editor fleet when the engine lane is
/// armed (the deployment configuration),
/// as the exact keys the --o: overrides produce: group[0] the public editor domains,
/// group[1] the VPC range as a scheme-wrapped regex for the engine lane's loopback
/// WOPI hosts on orchestrator task IPs.
Poco::AutoPtr<Poco::Util::MapConfiguration> makeEditorFleetConfig()
{
    Poco::AutoPtr<Poco::Util::MapConfiguration> config(new Poco::Util::MapConfiguration);
    config->setString("storage.wopi[@allow]", "true");
    // The shipped coolwsd.xml has an <alias_groups> element; parseAliases() only
    // reads the groups when that key exists.
    config->setString("storage.wopi.alias_groups", "");
    config->setString("storage.wopi.alias_groups[@mode]", "groups");
    config->setString("storage.wopi.alias_groups.group[0].host", "https://editor.example.com:443");
    config->setString("storage.wopi.alias_groups.group[0].host[@allow]", "true");
    config->setString("storage.wopi.alias_groups.group[0].alias[0]",
                      "https://editor-alias.example.com:443");
    config->setString("storage.wopi.alias_groups.group[1].host",
                      "https://10\\.8\\.[0-9]+\\.[0-9]+");
    config->setString("storage.wopi.alias_groups.group[1].host[@allow]", "true");
    return config;
}
}

void HostUtilTests::resetHostState(bool wopiEnabled)
{
    HostUtil::WopiHosts.clear();
    HostUtil::PublicWopiHosts.clear();
    HostUtil::AliasHosts.clear();
    HostUtil::hostList.clear();
    HostUtil::FirstHost.clear();
    HostUtil::WopiEnabled = wopiEnabled;
}

void HostUtilTests::testParseAlias()
{
    constexpr std::string_view testname = __func__;

    LOK_ASSERT_EQUAL_STR("test2\\.local", HostUtil::parseAlias("test2.local"));
    LOK_ASSERT_EQUAL_STR("test3\\.local", HostUtil::parseAlias("http://test3.local"));
    LOK_ASSERT_EQUAL_STR("test3\\.local", HostUtil::parseAlias("https://test3.local"));
    LOK_ASSERT_EQUAL_STR("test4\\.local", HostUtil::parseAlias("https://test4.local:8080"));
    LOK_ASSERT_EQUAL_STR("test5\\.local", HostUtil::parseAlias("https://test5.local:8080/"));
    LOK_ASSERT_EQUAL_STR("test6\\.local", HostUtil::parseAlias("https://test6.local:8080/path"));
    LOK_ASSERT_EQUAL_STR("test7\\.local", HostUtil::parseAlias("test7.local/path"));
    LOK_ASSERT_EQUAL_STR("test8", HostUtil::parseAlias("http://test8"));
    LOK_ASSERT_EQUAL_STR("test9", HostUtil::parseAlias("http://test9:8080"));
    LOK_ASSERT_EQUAL_STR("test10", HostUtil::parseAlias("http://test10:8080/"));
    LOK_ASSERT_EQUAL_STR("test11", HostUtil::parseAlias("http://test11:8080/path"));

    LOK_ASSERT_EQUAL_STR("test", HostUtil::parseAlias("test")); // identical result regardless of interpretation

    LOK_ASSERT_EQUAL_STR("test[1-3]", HostUtil::parseAlias("test[1-3]")); // invalid hostname, interpret as regex
    LOK_ASSERT_EQUAL_STR("test[0-9].local", HostUtil::parseAlias("test[0-9].local"));
    LOK_ASSERT_EQUAL_STR("test[0-9]+.local", HostUtil::parseAlias("test[0-9]+.local"));
    LOK_ASSERT_EQUAL_STR("", HostUtil::parseAlias("test[0-9.local")); // invalid regex

    LOK_ASSERT_EQUAL_STR("https://:8080", HostUtil::parseAlias("https://:8080")); // not a valid url, no hostname
    LOK_ASSERT_EQUAL_STR("/my-path", HostUtil::parseAlias("/my-path")); // not a valid url, no hostname

    LOK_ASSERT_EQUAL_STR("https://aliasname[0-9]{1}:443", HostUtil::parseAlias("https://aliasname[0-9]{1}:443"));
}

void HostUtilTests::testFirstHostTrustedOnlyInFirstMode()
{
    constexpr std::string_view testname = __func__;

    Poco::AutoPtr<Poco::Util::MapConfiguration> config(new Poco::Util::MapConfiguration);
    config->setString("storage.wopi[@allow]", "true");

    const ScopedHostConfig scopedConfig(config.get());

    const Poco::URI uri("https://wopi.example.com:8443/");

    // An administrator who selected groups mode but has not added a group yet.
    config->setString("storage.wopi.alias_groups[@mode]", "groups");
    resetHostState(true);
    HostUtil::setFirstHost(uri);
    LOK_ASSERT_MESSAGE("groups mode with no group must not record a first host",
                       HostUtil::FirstHost.empty());
    LOK_ASSERT_MESSAGE("groups mode with no group leaves the host list empty",
                       HostUtil::isWopiHostsEmpty());
    LOK_ASSERT_MESSAGE("groups mode with no group denies the connecting host",
                       !HostUtil::allowedWopiHost(uri.getHost(), /*serverToServer=*/false));

    // The same connection in first mode is adopted as the one trusted host.
    config->setString("storage.wopi.alias_groups[@mode]", "first");
    resetHostState(true);
    HostUtil::setFirstHost(uri);
    LOK_ASSERT_EQUAL_STR(uri.getAuthority(), HostUtil::FirstHost);
    LOK_ASSERT_MESSAGE("first mode trusts the connecting host",
                       HostUtil::allowedWopiHost(uri.getHost(), /*serverToServer=*/false));
}

void HostUtilTests::testInternalAliasGroupServesServerToServerOnly()
{
    constexpr std::string_view testname = __func__;

    Poco::AutoPtr<Poco::Util::MapConfiguration> config = makeEditorFleetConfig();
    Poco::AutoPtr<Poco::Util::LayeredConfiguration> layered(new Poco::Util::LayeredConfiguration);
    layered->addWriteable(config, 0);
    const ScopedHostConfig scopedConfig(layered.get());

    resetHostState(false);
    HostUtil::parseAliases(*layered);

    // group[0] answers exactly as before, whoever asks.
    for (const bool serverToServer : { false, true })
    {
        LOK_ASSERT_MESSAGE("the group[0] host serves every caller",
                           HostUtil::allowedWopiHost("editor.example.com", serverToServer));
        LOK_ASSERT_MESSAGE("a group[0] alias serves every caller",
                           HostUtil::allowedWopiHost("editor-alias.example.com", serverToServer));
        LOK_ASSERT_MESSAGE("an unlisted host is refused to every caller",
                           !HostUtil::allowedWopiHost("wopi.example.net", serverToServer));
        LOK_ASSERT_MESSAGE("an address outside the VPC range is refused to every caller",
                           !HostUtil::allowedWopiHost("10.9.3.4", serverToServer));
    }

    // The engine lane: the orchestrator connects straight to the editor (no proxy, peer
    // in net.post_allow) and names its own task IP as the WOPI host.
    LOK_ASSERT_MESSAGE("a group[1] address serves a server-to-server caller",
                       HostUtil::allowedWopiHost("10.8.3.4", /*serverToServer=*/true));

    // The same WOPISrc from the internet, through the load balancer: an SSRF into the VPC.
    LOK_ASSERT_MESSAGE("a group[1] address is refused to a public caller",
                       !HostUtil::allowedWopiHost("10.8.3.4", /*serverToServer=*/false));

    // StorageBase::validate() and the settings endpoints test every address a WOPISrc
    // host resolves to with the caller's trust, so a public name pointing into the VPC
    // reaches this same call with the resolved address and is refused here too.
    for (const char* resolved : { "10.8.0.1", "10.8.255.254" })
    {
        LOK_ASSERT_MESSAGE("an address resolved into group[1] is refused to a public caller",
                           !HostUtil::allowedWopiHost(resolved, /*serverToServer=*/false));
        LOK_ASSERT_MESSAGE("an address resolved into group[1] serves a server-to-server caller",
                           HostUtil::allowedWopiHost(resolved, /*serverToServer=*/true));
    }

    LOK_ASSERT_MESSAGE("the group[1] range is not a public entry",
                       !HostUtil::PublicWopiHosts.match("10.8.3.4"));
}

void HostUtilTests::testSecondaryGroupsInternalOff()
{
    constexpr std::string_view testname = __func__;

    Poco::AutoPtr<Poco::Util::MapConfiguration> config = makeEditorFleetConfig();
    config->setString("storage.wopi.alias_groups[@secondary_groups_internal]", "false");
    Poco::AutoPtr<Poco::Util::LayeredConfiguration> layered(new Poco::Util::LayeredConfiguration);
    layered->addWriteable(config, 0);
    const ScopedHostConfig scopedConfig(layered.get());

    resetHostState(false);
    HostUtil::parseAliases(*layered);

    // Turned off, every group serves every caller: the upstream behaviour.
    LOK_ASSERT_MESSAGE("with secondary_groups_internal=false group[1] serves a public caller",
                       HostUtil::allowedWopiHost("10.8.3.4", /*serverToServer=*/false));
    LOK_ASSERT_MESSAGE("with secondary_groups_internal=false group[0] still serves a public caller",
                       HostUtil::allowedWopiHost("editor.example.com", /*serverToServer=*/false));
}

void HostUtilTests::testNonPublicAddress()
{
    constexpr std::string_view testname = __func__;

    // What fetch-models refuses to a public caller: the VPC, the task's own loopback,
    // the metadata endpoints, and the same addresses in their IPv6 wrappings.
    for (const char* address :
         { "10.8.3.4", "10.0.0.0", "127.0.0.1", "169.254.169.254", "169.254.170.2",
           "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.255.255",
           "0.0.0.0", "192.0.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::", "::1",
           "fd00:ec2::254", "fc00::1", "fe80::1", "fe80::1%eth0", "fec0::1", "ff02::1",
           "::ffff:10.8.0.1", "::ffff:127.0.0.1", "::10.8.0.1", "64:ff9b::a08:101",
           "2002:a08:101::1", "not-an-address", "" })
    {
        LOK_ASSERT_MESSAGE(std::string("non-public: ") + address,
                           HostUtil::isNonPublicAddress(address));
    }

    // Public unicast, including the first address past each private block.
    for (const char* address :
         { "8.8.8.8", "1.1.1.1", "9.255.255.255", "11.0.0.0", "100.63.255.255", "100.128.0.0",
           "126.255.255.255", "128.0.0.0", "169.253.255.255", "169.255.0.0",
           "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0", "198.17.255.255",
           "198.20.0.0", "223.255.255.255", "2606:4700:4700::1111", "::ffff:8.8.8.8",
           "64:ff9b::808:808", "2002:808:808::1" })
    {
        LOK_ASSERT_MESSAGE(std::string("public: ") + address,
                           !HostUtil::isNonPublicAddress(address));
    }
}

CPPUNIT_TEST_SUITE_REGISTRATION(HostUtilTests);

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
