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
 * Implementation of host validation and alias parsing.
 * Functions: parseAliases(), isHostAllowed()
 */

#include <config.h>

// HostUtil is only used in non-mobile apps.
#if !MOBILEAPP

#include "HostUtil.hpp"

#include <common/CommandControl.hpp>
#include <common/ConfigUtil.hpp>
#include <common/Log.hpp>
#include <common/RegexUtil.hpp>

#include <arpa/inet.h>

#include <cstdint>
#include <cstring>
#include <map>
#include <regex>
#include <set>
#include <string>

RegexUtil::RegexListMatcher HostUtil::WopiHosts;
RegexUtil::RegexListMatcher HostUtil::PublicWopiHosts;
std::map<std::string, std::string> HostUtil::AliasHosts;
std::set<std::string> HostUtil::hostList;
std::string HostUtil::FirstHost;
bool HostUtil::WopiEnabled;
std::set<std::string> HostUtil::AllowedWSOriginList;

void HostUtil::parseWopiHost()
{
    // Parse the WOPI settings.
    WopiHosts.clear();
    PublicWopiHosts.clear();
    WopiEnabled = ConfigUtil::getBool("storage.wopi[@allow]", false);
    if (WopiEnabled)
    {
        for (size_t i = 0;; ++i)
        {
            const std::string path = "storage.wopi.host[" + std::to_string(i) + ']';
            if (!ConfigUtil::has(path))
            {
                break;
            }

            HostUtil::addWopiHost(ConfigUtil::getString(path, ""),
                                  ConfigUtil::getBool(path + "[@allow]", false));
        }
    }
}

void HostUtil::addWopiHost(const std::string& host, bool allow, bool serverToServerOnly)
{
    if (!host.empty())
    {
        if (allow)
        {
            if (serverToServerOnly)
            {
                LOG_INF("Adding trusted WOPI host for server-to-server requests only: ["
                        << host << "].");
                WopiHosts.allow(host);
            }
            else
            {
                LOG_INF("Adding trusted WOPI host: [" << host << "].");
                WopiHosts.allow(host);
                PublicWopiHosts.allow(host);
            }
        }
        else
        {
            LOG_INF("Adding blocked WOPI host: [" << host << "].");
            WopiHosts.deny(host);
            PublicWopiHosts.deny(host);
        }
    }
}

bool HostUtil::allowedWopiHost(const std::string& host, bool serverToServer)
{
    if (!WopiEnabled || !WopiHosts.match(host))
        return false;

    if (serverToServer || PublicWopiHosts.match(host))
        return true;

    LOG_WRN("WOPI host [" << host
                          << "] is admitted only by an internal alias group, which serves "
                             "server-to-server requests only (a net.post_allow peer with no "
                             "X-Forwarded-For); refusing it for this request");
    return false;
}

std::string HostUtil::parseAlias(const std::string& aliasPattern)
{
    if (!RegexUtil::isRegexValid(aliasPattern))
    {
        return {};
    }

    // check if it is plain uri, then convert to a strict regex for this uri if needed
    // Must be a full match.
    // Group 2 captures the hostname.
    static const std::regex re(
        "^(https?://)?(([a-z0-9\\-]+)(\\.[a-z0-9\\-]+)*)(:[0-9]{1,5})?(/[a-z0-9\\-&?_]*)*$",
        std::regex_constants::icase);

    std::smatch matches;
    if (std::regex_match(aliasPattern, matches, re) && matches.size() > 2)
    {
        std::string hostname = matches[2].str();

        if (hostname.empty())
        {
            LOG_DBG("parseAlias: error could not find hostname in: " << aliasPattern);
            return {};
        }

        // make the hostname a regex matching itself
        Util::replaceAllSubStr(hostname, ".", "\\.");

        return hostname;
    }

    // this is a regex
    return aliasPattern;
}

void HostUtil::parseAliases(Poco::Util::LayeredConfiguration& conf)
{
    WopiEnabled = conf.getBool("storage.wopi[@allow]", false);

    //set alias_groups mode to compat
    if (!conf.has("storage.wopi.alias_groups"))
    {
        conf.setString("storage.wopi.alias_groups[@mode]", "compat");
        return;
    }

    if (conf.has("storage.wopi.alias_groups.group[0]"))
    {
        // group defined in alias_groups
        if (Util::iequal(ConfigUtil::getString("storage.wopi.alias_groups[@mode]", "first"),
                         "first"))
        {
            LOG_ERR("Admins did not set the alias_groups mode to 'groups'");
            AliasHosts.clear();
            return;
        }
    }
    else if (Util::iequal(ConfigUtil::getString("storage.wopi.alias_groups[@mode]", "first"),
                          "groups"))
    {
        LOG_WRN("alias_groups mode is 'groups' but no <group> is defined; all WOPI "
                "hosts will be denied. Define at least one group, or use mode='first'.");
    }

    AliasHosts.clear();
    WopiHosts.clear();
    PublicWopiHosts.clear();
    hostList.clear();
#if ENABLE_FEATURE_LOCK
    CommandControl::LockManager::unlockLinkMap.clear();
#endif

    // group[0] holds the public editor domains: any caller may name its host or
    // aliases. Every later group is internal (e.g. a VPC address range admitted
    // for WOPI hosts that coolwsd reaches directly), and is honored only for
    // server-to-server requests unless the admin turns this off.
    const bool secondaryGroupsInternal =
        conf.getBool("storage.wopi.alias_groups[@secondary_groups_internal]", true);

    for (size_t i = 0;; i++)
    {
        const std::string path = "storage.wopi.alias_groups.group[" + std::to_string(i) + ']';
        if (!conf.has(path + ".host"))
        {
            break;
        }

        const std::string uri = conf.getString(path + ".host", "");
        if (uri.empty())
        {
            continue;
        }

        const bool allow = conf.getBool(path + ".host[@allow]", false);
        const bool serverToServerOnly = secondaryGroupsInternal && i > 0;
        if (serverToServerOnly)
            LOG_INF("parseAliases: alias group [" << i
                                                  << "] serves server-to-server requests only");
        const Poco::URI realUri(uri);

        try
        {
#if ENABLE_FEATURE_LOCK
            CommandControl::LockManager::mapUnlockLink(realUri.getHost(), path);
#endif
            HostUtil::hostList.insert(realUri.getHost());
            HostUtil::addWopiHost(realUri.getHost(), allow, serverToServerOnly);
        }
        catch (const Poco::Exception& exc)
        {
            LOG_WRN("parseAliases: " << exc.displayText());
        }

        static bool warnedInvalidRegex = false;
        static bool warnedAboutPipe = false;
        for (size_t j = 0;; j++)
        {
            const std::string aliasPath = path + ".alias[" + std::to_string(j) + ']';
            if (!conf.has(aliasPath))
            {
                break;
            }

            auto aliasString = conf.getString(aliasPath, "");
            if (aliasString.empty())
            {
                continue;
            }

            if (!warnedAboutPipe && aliasString.find('|') != std::string::npos)
            {
                LOG_WRN(
                    "Using | to define multiple alias is deprecated, it is recommended to use an "
                    "<alias> element for each alias. If the | is part of a regex disregard.");
            }

            for (std::string& aliasPattern : Util::splitStringToVector(aliasString, '|'))
            {
                aliasPattern = parseAlias(aliasPattern);
                if (aliasPattern.empty())
                {
                    if (!warnedInvalidRegex)
                        LOG_WRN("parseAliases: found invalid alias pattern: [" << aliasPattern << "] for uri" << uri);
                    continue;
                }
                LOG_DBG("parseAliases: Mapped URI alias ["
                        << aliasPattern << "] to canonical URI [" << realUri.getAuthority()
                        << ']');
                AliasHosts.emplace(aliasPattern, realUri.getAuthority());
#if ENABLE_FEATURE_LOCK
                CommandControl::LockManager::mapUnlockLink(aliasPattern, path);
#endif
                HostUtil::addWopiHost(aliasPattern, allow, serverToServerOnly);
            }
        }
        warnedInvalidRegex = true;
        warnedAboutPipe = true;
    }
}

std::string HostUtil::getNewUri(const Poco::URI& uri)
{
    if (Util::iequal(ConfigUtil::getString("storage.wopi.alias_groups[@mode]", "first"), "compat"))
    {
        return uri.getPath();
    }

    Poco::URI newUri(uri);
    const std::string value = RegexUtil::getValue(AliasHosts, newUri.getAuthority());
    if (!value.empty())
    {
        newUri.setAuthority(value);
    }
    else
    {
        // It is allowed for the host to be a regex.
        // In that case, the first who connects is treated as the 'host', and stored to the AliasHosts here
        const std::string val = RegexUtil::getValue(hostList, newUri.getHost());
        // compare incoming request's host with existing hostList , if they are not equal it is regex and we store
        // the pair in AliasHosts
        if (!val.empty() && val.compare(newUri.getHost()) != 0)
        {
            LOG_DBG("Mapped URI alias [" << val << "] to canonical URI [" << newUri.getHost()
                                         << ']');
            AliasHosts.emplace(val, newUri.getHost());
        }
    }

    if (newUri.getAuthority().empty())
    {
        return newUri.getPath();
    }

    return newUri.getScheme() + "://" + newUri.getHost() + ':' + std::to_string(newUri.getPort()) +
           newUri.getPath();
}

const Poco::URI HostUtil::getNewLockedUri(const Poco::URI& uri)
{
    Poco::URI newUri(uri);
    const std::string value = RegexUtil::getValue(AliasHosts, newUri.getAuthority());
    if (!value.empty())
    {
        newUri.setAuthority(value);
        LOG_WRN("The locked_host: " << uri.getAuthority() << " is alias of "
                                    << newUri.getAuthority() << ", Applying "
                                    << newUri.getAuthority() << " locked_host settings.");
    }

    return newUri;
}

void HostUtil::setFirstHost(const Poco::URI& uri)
{
    if (!Util::iequal(ConfigUtil::getString("storage.wopi.alias_groups[@mode]", "first"), "first"))
        return;

    if (WopiHosts.empty())
    {
        if (FirstHost.empty())
        {
            FirstHost = uri.getAuthority();
            addWopiHost(uri.getHost(), true);
        }
    }
    else if(!FirstHost.empty() && FirstHost != uri.getAuthority())
    {
        LOG_ERR("Only allowed host is: "
                << FirstHost
                << ", To use multiple host/aliases check alias_groups tag in configuration");
    }
}

void HostUtil::parseAllowedWSOrigins()
{
    for (size_t i = 0;; i++)
    {
        const std::string path =
            "indirection_endpoint.geolocation_setup.allowed_websocket_origins.origin[" +
            std::to_string(i) + ']';
        if (!ConfigUtil::has(path))
        {
            break;
        }
        std::string origin = ConfigUtil::getString(path, "");
        if (!origin.empty())
        {
            LOG_INF("Adding Origin[" << origin << "] to allowed websocket origin list");
            HostUtil::AllowedWSOriginList.insert(std::move(origin));
        }
    }
}

bool HostUtil::allowedWSOrigin(const std::string& origin)
{
    return AllowedWSOriginList.find(origin) != AllowedWSOriginList.end();
}

bool HostUtil::isWopiHostsEmpty()
{
    return WopiHosts.empty();
}

bool HostUtil::isForbiddenKitHost(const std::string& host)
{
    static const char* allowlist = std::getenv("KIT_HOST_ALLOWLIST");
    if (!allowlist || allowlist[0] == '\0')
        return false;

    static const std::regex allowedRegex(allowlist);
    return !std::regex_match(host, allowedRegex);
}

namespace
{
/// The IPv4 half of HostUtil::isNonPublicAddress(), on the four network-order bytes.
bool isNonPublicIPv4(const std::uint8_t* a)
{
    return a[0] == 0                                  // "this" network, 0.0.0.0
           || a[0] == 10                              // RFC 1918
           || (a[0] == 100 && (a[1] & 0xC0) == 64)    // RFC 6598 shared space
           || a[0] == 127                             // loopback
           || (a[0] == 169 && a[1] == 254)            // link-local, cloud metadata
           || (a[0] == 172 && (a[1] & 0xF0) == 16)    // RFC 1918
           || (a[0] == 192 && a[1] == 0 && a[2] == 0) // IETF protocol assignments
           || (a[0] == 192 && a[1] == 168)            // RFC 1918
           || (a[0] == 198 && (a[1] & 0xFE) == 18)    // benchmarking
           || a[0] >= 224;                            // multicast, reserved, broadcast
}
} // namespace

bool HostUtil::isNonPublicAddress(const std::string& address)
{
    // An IPv6 zone index ("fe80::1%eth0") does not change what the address is.
    const std::string bare = address.substr(0, address.find('%'));

    std::uint8_t v4[4];
    if (inet_pton(AF_INET, bare.c_str(), v4) == 1)
        return isNonPublicIPv4(v4);

    std::uint8_t v6[16];
    if (inet_pton(AF_INET6, bare.c_str(), v6) != 1)
        return true;

    // These carry an IPv4 address that the packet ends up at (or that a translator
    // forwards to), so that address decides: ::ffff:a.b.c.d (mapped), ::a.b.c.d
    // (compatible, which also covers :: and ::1) and 64:ff9b::a.b.c.d (NAT64) hold it
    // in the last four bytes, 2002:AABB:CCDD::/48 (6to4) right after the prefix.
    static constexpr std::uint8_t zeros[12] = {};
    static constexpr std::uint8_t nat64[12] = { 0x00, 0x64, 0xff, 0x9b };
    const bool mapped = std::memcmp(v6, zeros, 10) == 0 && v6[10] == 0xff && v6[11] == 0xff;
    if (mapped || std::memcmp(v6, zeros, 12) == 0 || std::memcmp(v6, nat64, 12) == 0)
        return isNonPublicIPv4(v6 + 12);
    if (v6[0] == 0x20 && v6[1] == 0x02)
        return isNonPublicIPv4(v6 + 2);

    return (v6[0] & 0xFE) == 0xFC                       // unique-local fc00::/7
           || (v6[0] == 0xFE && (v6[1] & 0xC0) == 0x80) // link-local fe80::/10
           || (v6[0] == 0xFE && (v6[1] & 0xC0) == 0xC0) // old site-local fec0::/10
           || v6[0] == 0xFF;                            // multicast
}

#endif // !MOBILEAPP

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
