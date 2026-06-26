# Contributing Guide

[简体中文](./CONTRIBUTING.zh-CN.md)

Thank you for contributing to OctoBus. OctoBus is an open-source project that allows the community to build service packages and connectors based on lawful, public, and authorized interfaces for integrating with different systems or devices.

To protect the project, users, contributors, and third-party vendors, all contributions must follow the rules below. Project maintainers use these rules as the basis for pull request review, temporary removal, and later re-review.

## Accepted Contributions

We welcome contributions that:

- Use official public documentation, public APIs, public SDKs, public protocols, or interfaces that users are legally authorized to access;
- Do not include third-party proprietary code, trade secrets, or unauthorized materials;
- Do not bypass authentication, authorization, licenses, rate limits, or other technical protection measures;
- Do not simulate official clients, login flows, or user behavior to access data that is not supported by a public API;
- Do not use names, documentation, or examples that may mislead users into believing the connector is officially authorized, certified, or endorsed by a third-party vendor;
- Do not include real customer data, real secrets, real certificates, access tokens, or sensitive configuration in example code.

## Prohibited Contributions

We explicitly reject code, documentation, or materials that include:

- Interface implementations obtained through reverse engineering, packet capture reconstruction, decompilation, cracking, or circumvention of technical protection measures;
- Unauthorized closed-source SDKs, private headers, internal protocol files, internal API documentation, or vendor proprietary code;
- Implementations that bypass authentication, crack licenses, simulate official clients, call unpublished endpoints, evade rate limits, or scrape web pages or admin consoles;
- Third-party trade secrets, copyrighted code without authorization, configuration, schemas, proto files, generated code, or sample data without proper rights;
- Hardcoded secrets, tokens, usernames and passwords, certificates, customer environment information, or other sensitive information;
- Names, logos, screenshots, or descriptions that may mislead users into believing this project has an official partnership, authorization, certification, or endorsement from a third-party vendor.

## License and Intellectual Property

OctoBus is licensed under the GNU General Public License v3.0 (GPL-3.0).

### GPL-3.0 Compatibility Requirements

By submitting a contribution, you confirm that:

1. Your contribution does not depend on or include code that is incompatible with GPL-3.0, such as proprietary code, closed-source SDKs, AGPL, or SSPL code;
2. If your contribution is based on existing work, that work is licensed or authorized in a way that allows you to submit and redistribute it;
3. Your contribution does not infringe any third-party copyright, trademark, patent, trade secret, license right, or other legal right;
4. You have the right to submit the code, documentation, and materials under the GPL-3.0 license.

### Source Declaration

For contributions involving third-party systems or devices, please explain the source of the code in the pull request:

- Is the code entirely original, or is it adapted from existing work?
- If it is adapted from existing work, what is the source, license, and authorization model of the original work?
- Does it depend on any third-party SDK? If so, what is the SDK license, and is it compatible with GPL-3.0?

Maintainers may ask contributors to provide code provenance details, interface source details, license explanations, or other compliance evidence. Contributions with unclear or insufficient source information may be rejected.

## Commit Sign-off Requirement

Contributors need to add a Signed-off-by line to commits to confirm that they have the right to submit the contribution and agree to release it under the project license.

For commits without a Signed-off-by line, maintainers may ask contributors to add the sign-off, provide source explanations, or submit other supporting materials.

### How to Add a Sign-off

Use the `-s` flag when committing:

```bash
git commit -s -m "Add new feature"
```

This generates a commit message like:

```text
Add new feature

Signed-off-by: Your Name <your.email@example.com>
```

### What the Sign-off Means

By adding a sign-off, you confirm that:

1. You have the right to submit the code, documentation, and materials;
2. Your contribution does not violate the terms of service of the target system, device, platform, or service;
3. Your contribution was not obtained through reverse engineering, cracking, authentication bypass, client simulation, packet capture reconstruction, web scraping, or circumvention of technical protection measures;
4. Your contribution does not include real secrets, real customer data, or other information that should not be public.

If you need to add a sign-off to the latest commit, you can use:

```bash
git commit --amend -s
```

## Connector / Service Package Review Criteria

If a contribution involves a third-party system or device, please explain the following in the pull request:

- The target system, device, platform, or service name;
- The interface source, such as official public documentation, public API, public SDK, public protocol, or user-authorized interface;
- Whether the contribution depends on a third-party SDK, including the SDK license, acquisition method, and usage conditions;
- Whether the SDK license is compatible with GPL-3.0;
- Whether users must provide API credentials, tokens, certificates, or other authorization materials;
- Whether the integration involves rate limits, quotas, audit logs, data export, or target-system terms-of-service restrictions;
- Whether the integration includes high-risk operations, such as rebooting devices, deleting policies, disabling protection, or bulk-changing configuration;
- The test approach, documentation, and source of sample data.

Project maintainers review contributions according to these rules. For submissions with unclear provenance, questionable interface legality, closed-source dependencies, sensitive information, or possible third-party rights disputes, maintainers may request clarification, require changes, reject the contribution, or temporarily remove related materials after merge.

## Official and Community Contribution Boundary

Connectors or service packages merged into this repository or referenced by project documentation may still be maintained by community contributors. Unless explicitly stated by the project, do not use `official`, vendor logos, vendor trademarks, or other names and presentation that may cause users to believe the connector has official authorization, certification, or endorsement from a third-party vendor.

## Compliance Complaints

If you believe any content in this project infringes your rights or includes unauthorized code, documentation, interface implementations, secrets, trade secrets, or other disputed materials, please contact us through the compliance complaint channel described in the [Security Feedback](./SECURITY.md).
