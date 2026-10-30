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
 * Host and alias management utilities.
 * Functions: parseAliases(), isHostAllowed()
 */

#pragma once

#include <config.h>

// HostUtil is only used in non-mobile apps.
#if !MOBILEAPP

#include <common/RegexUtil.hpp>

#include <Poco/URI.h>
#include <Poco/Util/Application.h>

#include <set>
#include <string>

/// This class contains static methods to parse alias_groups and WOPI host and static containers to store the data from the coolwsd.xml
class HostUtil
{
private:
    /// Allowed/denied WOPI hosts, if any and if WOPI is enabled. Every entry, from
    /// every alias group: what a server-to-server request may use.
    static RegexUtil::RegexListMatcher WopiHosts;
    /// The entries any caller may use: storage.wopi.host, the first host in 'first'
    /// mode, and alias_groups.group[0]. While storage.wopi.alias_groups[@secondary_groups_internal]
    /// is true (the default), the hosts and aliases of group[1] and later are left out
    /// of this list, so only a server-to-server request can reach them. See
    /// allowedWopiHost().
    static RegexUtil::RegexListMatcher PublicWopiHosts;
    /// mapping of alias host and port to real host and port
    static std::map<std::string, std::string> AliasHosts;
    /// When group configuration is not defined only the firstHost gets access
    static std::string FirstHost;
    /// list of host (not aliases) in alias_groups
    static std::set<std::string> hostList;
    /// list of allowed websocket origin, used only when indirection_endpoint.geolocation is enabled
    static std::set<std::string> AllowedWSOriginList;

    static bool WopiEnabled;

public:
    /// parse wopi.storage.host
    static void parseWopiHost();

    /// parse wopi.storage.alias_groups.group
    static void parseAliases(Poco::Util::LayeredConfiguration& conf);

    /// parse indirection_endpoint.geolocation_setup.allowed_websocket_origins
    static void parseAllowedWSOrigins();

    /// if request uri is an alias, replace request uri host and port with
    /// original hostname and port defined by group tag from coolwsd.xml
    /// to avoid possibility of opening the same file as two if the WOPI host
    /// is accessed using different aliases
    static std::string getNewUri(const Poco::URI& uri);

    /// True iff host (a name or an address) is an allowed WOPI host for this caller.
    /// serverToServer is the caller's trust, from ClientRequestDispatcher::isServerToServer():
    /// true only for a request whose TCP peer matches net.post_allow and that carries no
    /// X-Forwarded-For. A server-to-server caller may use every alias group; any other
    /// caller only the public entries (see PublicWopiHosts), so a host admitted solely by
    /// an internal group is refused exactly like an unlisted one. The answer for a host
    /// the public entries admit does not depend on serverToServer.
    static bool allowedWopiHost(const std::string& host, bool serverToServer);

    static bool isWopiEnabled() { return WopiEnabled; }

    /// replace the authority of aliashost to realhost if it matches
    static const Poco::URI getNewLockedUri(const Poco::URI& uri);

    static void setFirstHost(const Poco::URI& uri);

    static bool isWopiHostsEmpty();

    static bool allowedWSOrigin(const std::string& origin);

    static bool isForbiddenKitHost(const std::string& host);

    /// True iff address (a numeric IPv4 or IPv6 address, as net::resolveAddresses()
    /// returns them) is not a public internet unicast address: unspecified, loopback,
    /// private (RFC 1918, RFC 6598 shared space, IPv6 unique-local), link-local (where
    /// the cloud metadata endpoints live), multicast or reserved, including any of those
    /// carried inside an IPv4-mapped, IPv4-compatible, NAT64 or 6to4 IPv6 address.
    /// A string that is not an address is non-public too: nothing vouches for it.
    /// Used to keep an unauthenticated public caller from steering an outbound request
    /// into the network coolwsd runs in (see FileServerRequestHandler::fetchModels()).
    static bool isNonPublicAddress(const std::string& address);

private:
    /// parse a single alias from groups of alias_groups, return an empty string if the pattern was invalid
    ///
    /// valid shared.*\.com
    /// valid my-domain-(sub1|sub2).com
    /// valid my-domain.com
    /// invalid my-domain[1
    static std::string parseAlias(const std::string& aliasPattern);

    /// add host to WopiHosts, and to PublicWopiHosts unless it is an allowed entry of an
    /// internal (server-to-server only) alias group. A deny goes to both lists.
    static void addWopiHost(const std::string& host, bool allow, bool serverToServerOnly = false);

    friend class HostUtilTests;
};
#endif // !MOBILEAPP

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
