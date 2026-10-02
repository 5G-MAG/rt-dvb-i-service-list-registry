<p align="center">
  <img src=".github/banner.svg" width="100%" alt="Reference Tools · DVB-I Services over 5G Systems: DVB-I Service List Registry">
</p>

<p align="center">
  Answers DVB-I client queries with a list of Service List Entry Points, per ETSI TS 103 770 V1.2.1
  clause 5.1.3.2.
</p>

<p align="center">
  <img alt="Status: Under Development"
    src="https://img.shields.io/badge/Status-Under_Development-yellow">
  <a href="https://github.com/5G-MAG/rt-dvb-i-service-list-registry/releases"><img alt="Version"
    src="https://img.shields.io/github/v/release/5G-MAG/rt-dvb-i-service-list-registry?label=Version&sort=semver"></a>
  <a href="LICENSE"><img alt="License: 5G-MAG Public License v1.0"
    src="https://img.shields.io/badge/License-5G--MAG%20PL%20v1.0-blue"></a>
</p>

<p align="center">
  <a href="https://www.5g-mag.com/reference-tools/dvb-i">Project page</a> &nbsp;&middot;&nbsp;
  <a href="https://github.com/5G-MAG/rt-dvb-i-service-list-registry/issues">Issues</a> &nbsp;&middot;&nbsp;
  <a href="https://www.5g-mag.com/contributing">Contributing</a>
</p>

---

## At a glance

|  |  |
|---|---|
| **Implements** | ETSI TS 103 770 V1.2.1 (2024-09), *Digital Video Broadcasting (DVB); Service Discovery and Programme Metadata for DVB-I*, clause 5.1.3.2 (Service List Registry) |
| **Part of** | [DVB-I Services over 5G Systems](https://www.5g-mag.com/reference-tools/dvb-i), alongside [rt-dvb-i-application](https://github.com/5G-MAG/rt-dvb-i-application), [rt-dvb-i-application-provider](https://github.com/5G-MAG/rt-dvb-i-application-provider), [rt-dvb-i-examples](https://github.com/5G-MAG/rt-dvb-i-examples) and [rt-5gms-application](https://github.com/5G-MAG/rt-5gms-application) |

## Introduction

A DVB-I client has to find service lists before it can show anything. The Service List Registry is
the component it asks. ETSI TS 103 770 V1.2.1 clause 5.1.3.2 defines it as an HTTP endpoint at a
known URL that, queried, returns a list of Service List Entry Points.

It is the third component of the architecture in clause 4.1 of that specification, alongside the
Service List Server and Content Guide Server (`rt-dvb-i-application-provider`) and the DVB-I client
(`rt-dvb-i-application`). Without it, a client either has a service list URL typed into it by hand
or depends on somebody else's registry.

Registering entry points over the network is out of scope here; see [Limitations](#limitations).

## Specification

Built against **ETSI TS 103 770 V1.2.1 (2024-09)**, a version rather than a release name.

Clause-by-clause coverage, and what is still absent, is recorded on the project page rather than
here: <https://www.5g-mag.com/reference-tools/dvb-i>

## Downloading

```bash
cd ~
git clone https://github.com/5G-MAG/rt-dvb-i-service-list-registry.git
```

## Running

```bash
npm install
npm start           # http://localhost:7000/query
```

## Configuration

Three environment variables:

- `PORT` changes the port (default 7000).
- `REGISTRY_PATH` points at a different registry file (default `registry.json`).
- `LOG_LEVEL` is one of `error`, `warn`, `info` (default) or `debug`.

## Development

```bash
npm test                                                   # unit tests, XSD skips without schemas
DVBI_SCHEMAS=~/.local/share/dvb-i-schemas/etsi npm test     # with conformance checking
```

The unit tests follow the clause rather than this implementation: which parameters exist, how
repeated values combine, and which status an unacceptable query gets. The XSD check validates the
response for an empty query, for filtered queries, and for a query that matches nothing, since
filtering is where a schema sequence tends to break.

No schema file is carried in this repository and none may be. Supply them through `DVBI_SCHEMAS`
from a directory outside the working tree; without it the check skips and `npm test` stays green.
The CI workflow, `.github/workflows/test.yml`, runs `npm test` without schemas, so the XSD check
skips there.

## The page at `/`

Opening the registry in a browser shows what it offers and lets you run the queries of clause
5.1.3.2 against it. It uses the same presentation as the sibling tools, the shared `blue-bar.css`
header and the 5G-MAG mark, so the components of a running demo look like one system rather than
unrelated pages.

The page is **read only**, deliberately. Clause 5.1.3.2 puts how a registry collects and stores its
information out of scope, so an editing interface would implement nothing specified, and would give
a discovery endpoint the one thing it otherwise lacks: a way to change its contents over the
network. Registration is by editing `registry.json`.

## Querying it

```
GET /query?TargetCountry=CHE
GET /query?TargetCountry=ITA&regulatorListFlag=true
GET /query?Delivery[]=dvb-dash&Delivery[]=dvb-t
GET /query?ProviderName=5G-MAG
```

The parameters are those clause 5.1.3.2 lists, in the order it presents them: `TargetCountry`,
`regulatorListFlag`, `Delivery`, `Language`, `Genre`, `ProviderName`, `inlineImages`. Repeated
values use square brackets, `TargetCountry[]=AUT&TargetCountry[]=DEU`. The clause requires them to
be read as alternatives: values for one parameter are OR, different parameters narrow together.
An offering that specifies no `TargetCountry`, no `Language` or no `Genre` is included in any query
for that parameter, as clause 5.1.3.2 and table 12 of clause 5.3.5 require.

- A query naming an unknown parameter, or giving an invalid value, is refused with 400, as the
  clause requires. `TargetCountry` takes upper-case three-letter codes, alone or comma separated
  (`tva:ISO-3166-List`); `Language` takes a language tag such as `en` or `de-CH` (the XML Schema
  `language` type); `Delivery` takes the values of table 12b; `regulatorListFlag` and
  `inlineImages` take `true` or `false`.
- A request URL over 2 048 characters is refused with 414. That is the limit the clause sets.
- A query matching nothing returns a valid document with no offerings rather than an error.

## What it serves

`registry.json` is what the registry knows. The specification leaves how a registry collects and
stores this out of scope, so a file is as valid as a database and easier to read in a reference
implementation. Each entry names the list, its URLs, the delivery types it offers, the countries
and languages it targets, and whether it is a regulator's list.

Three delivery types cannot be written without values the specification makes mandatory: the
network ID of `DVBCDelivery`, the orbital positions of `DVBSDelivery`, and the application types of
`ApplicationDelivery` (clause 5.3.6). An entry gives them in `deliveryParameters`; one declared
without them is left out of the response, does not match a `Delivery` query for it, and is logged
as a warning. A regulator's list is written with `regulatorListFlag="true"`, and every
`ServiceListURI` is labelled `application/vnd.dvb.dvbisl+xml`, the media type a Service List is
served with (clause 5.1.2).

The response is a `ServiceListEntryPoints` document in `urn:dvb:metadata:servicelistdiscovery:2024`,
per `dvbi_service_list_discovery_v1.6.xsd`. That schema ships in the electronic attachment archive
accompanying TS 103 770 (annex B lists it).

If you extend it: `ServiceListOffering` is declared by the discovery schema but carries a type from
`dvbi_types_v1.0.xsd`, so all of its children belong to the `servicediscovery-types` namespace
rather than the discovery one. Emitting them unprefixed produces a document that looks right and
fails validation.

## 5G delivery

TS 103 770 V1.2.1 gives a registry no way to say that a service list is also carried over 5G
Broadcast: `DeliveryType` (clause 5.3.6.1) has no MBMS child, and table 12b has no `Delivery` query
value for it, so a query for one gets the 400 any undefined value gets. This registry adds nothing
of its own for it. A service instance delivered over 5G Broadcast is signalled in the service list
itself, as `IdentifierBasedDeliveryParameters` holding an `mbms://` locator; see the provider.

## Limitations

- Registration is by editing `registry.json`. The M interface of clause 4.1, by which a provider
  registers its own entry points, is not implemented.
- `Genre` values are not validated, so an invalid one matches only offerings that specify no genre
  instead of getting a 400. Clause 5.1.3.2 does not say what form a `Genre` query value takes, so
  which values are invalid is not decided here.
- `TargetCountry` and `Language` are checked against their schema types only: `ZZZ` and `xx` are
  accepted, since the ISO 3166 code list and the language subtag registry are not checked.
- `inlineImages` is accepted and validated but does not change the response: images are never
  inlined.
- Server-side region selection (clause 5.6.4) is not implemented; `SRSSupport` is not advertised.
- A client learns nothing about 5G delivery from this registry, since TS 103 770 defines no way to
  say it (see above).

## Contributing

Contributions are welcome. How to raise an issue, fork the repository and open a pull request, and
the Contributor License Agreement required before code can be merged, are described at
<https://www.5g-mag.com/contributing>.

## License

Distributed under the 5G-MAG Public License v1.0. See [LICENSE](LICENSE).
