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

# also check the response that carries the local 5G extension
DVBI_SCHEMAS=~/.local/share/dvb-i-schemas/etsi \
DVBI_5G_EXT_SCHEMA=../rt-dvb-i-application-provider/schemas/dvbi-5g-ext-1.0.xsd npm test
```

The unit tests follow the clause rather than this implementation: which parameters exist, how
repeated values combine, and which status an unacceptable query gets. The XSD check validates the
response for an empty query, for filtered queries, and for a query that matches nothing, since
filtering is where a schema sequence tends to break.

No schema file is carried in this repository and none may be. Supply them through `DVBI_SCHEMAS`
from a directory outside the working tree; without it the check skips and `npm test` stays green.
If the directory is given but a file is missing, the check stops and names the missing files.
Where to get them is in [Where the schema files come from](#where-the-schema-files-come-from).
The CI workflow, `.github/workflows/test.yml`, runs `npm test` without schemas, so the XSD check
skips there.

## Where the schema files come from

The XSD check needs the discovery schema and the files it imports. All but one are in the
electronic attachments of ETSI TS 103 770 V1.2.1: annex B (normative) says they are contained in the
archive `ts_103770v010201p0.zip`, which accompanies the specification. The archive is published by
ETSI next to the PDF:

```
https://www.etsi.org/deliver/etsi_ts/103700_103799/103770/01.02.01_60/ts_103770v010201p0.zip
```

**A plain `curl` or `wget` of that address is refused with 403**, because the ETSI server rejects
the default command-line User-Agent. The same request with a browser-style User-Agent returns the
file (checked 2026-10-21), and so does a browser download from the specification's page on
etsi.org:

```bash
curl -L -A "Mozilla/5.0" -o ts_103770v010201p0.zip \
  https://www.etsi.org/deliver/etsi_ts/103700_103799/103770/01.02.01_60/ts_103770v010201p0.zip
mkdir -p ~/.local/share/dvb-i-schemas/etsi
unzip -j ts_103770v010201p0.zip '*.xsd' -x 'xmlait/*' -d ~/.local/share/dvb-i-schemas/etsi
curl -L -A "Mozilla/5.0" -o ~/.local/share/dvb-i-schemas/etsi/xml.xsd https://www.w3.org/2001/xml.xsd
```

The files this repository uses, and where each is from:

| File | Source |
|---|---|
| `dvbi_service_list_discovery_v1.6.xsd` | the archive, annex B |
| `dvbi_types_v1.0.xsd` | the archive, annex B |
| `tva_metadata_3-1.xsd` | the archive, annex B |
| `tva_mpeg7.xsd` | the archive, annex B |
| `xml.xsd` | not in the archive; W3C, <https://www.w3.org/2001/xml.xsd> |

**File names.** Annex B and the archive call the TV-Anytime schema `tva_metadata_3-1.xsd`, and the
discovery schema imports it under that name. This repository fetches no schema itself, so it uses
exactly that name and nothing else. Some other DVB-I tooling, including the sibling provider
repository `rt-dvb-i-application-provider`, refers to `tva_metadata_3-1_2024.xsd`, a name that is
not in annex B. If you hold a file by that name, it has to be copied or renamed to
`tva_metadata_3-1.xsd` for the discovery schema to find it; this repository has not compared the two
files' contents, so the archive copy is the one to use here. The base service list schema
`dvbi_v6.0.xsd` is in the archive too, but this registry does not use it.

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

- A query naming an unknown parameter, or giving an invalid value, is refused with 400, as the
  clause requires.
- A request URL over 2 048 characters is refused with 414. That is the limit the clause sets.
- A query matching nothing returns a valid document with no offerings rather than an error.

## What it serves

`registry.json` is what the registry knows. The specification leaves how a registry collects and
stores this out of scope, so a file is as valid as a database and easier to read in a reference
implementation. Each entry names the list, its URLs, the delivery types it offers, the countries
and languages it targets, and whether it is a regulator's list.

The response is a `ServiceListEntryPoints` document in `urn:dvb:metadata:servicelistdiscovery:2024`,
per `dvbi_service_list_discovery_v1.6.xsd`. That schema ships in the electronic attachment archive
accompanying TS 103 770 (annex B lists it); see
[Where the schema files come from](#where-the-schema-files-come-from).

If you extend it: `ServiceListOffering` is declared by the discovery schema but carries a type from
`dvbi_types_v1.0.xsd`, so all of its children belong to the `servicediscovery-types` namespace
rather than the discovery one. Emitting them unprefixed produces a document that looks right and
fails validation.

## The local 5G broadcast extension

An offering may declare `"extensions": ["5g-mbms"]`, meaning the service list is also carried over
5G broadcast (MBMS). **Nothing in DVB defines this.** `DeliveryType` (TS 103 770 V1.2.1, clause
5.3.6.1) has no MBMS child, so the marker rides the extension point that type does provide,
`OtherDeliveryParameters`, with an `xsi:type` from the 5G-MAG namespace
`urn:5g-mag:metadata:dvbi-5g:2026`:

```xml
<dvbisd-t:Delivery>
  <dvbisd-t:DASHDelivery/>
  <!-- Local extension, not DVB-specified -->
  <dvbisd-t:OtherDeliveryParameters extensionName="urn:5g-mag:dvbi-5g:mbms"
                                    xsi:type="dvbi5g:MBMSOfferingType"/>
</dvbisd-t:Delivery>
```

The schema for that type is `schemas/dvbi-5g-ext-1.0.xsd` in the provider repository, which owns
the extension. The namespace is declared only in responses that actually use it, so a reader can
tell from the declarations alone whether a response relies on anything non-DVB. The dashboard
shows it in its own Extensions column rather than merged into Delivery.

It is deliberately **not** a `Delivery` query value. Table 12b is a closed set and an unlisted value
gets a 400, so a seventh one would make the query interface non-conformant. The extension is
emitted and displayed; it is not queryable.

## Limitations

- Registration is by editing `registry.json`. The M interface of clause 4.1, by which a provider
  registers its own entry points, is not implemented.
- `Genre` and `inlineImages` are accepted and validated but do not change the response: no entry in
  the registry file carries genres, and images are never inlined.
- Server-side region selection (clause 5.6.4) is not implemented; `SRSSupport` is not advertised.
- The 5G broadcast marker above is a local extension, not conformance. A client that does not know
  the namespace ignores it, which is the intended behaviour, but it will also learn nothing about
  5G availability from this registry until DVB specifies a delivery type for it.

## Contributing

Contributions are welcome. How to raise an issue, fork the repository and open a pull request, and
the Contributor License Agreement required before code can be merged, are described at
<https://www.5g-mag.com/contributing>.

## License

Distributed under the 5G-MAG Public License v1.0. See [LICENSE](LICENSE).
