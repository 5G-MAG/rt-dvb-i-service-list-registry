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
| **Part of** | [DVB-I Services over 5G Systems](https://www.5g-mag.com/reference-tools/dvb-i), alongside [rt-dvb-i-application](https://github.com/5G-MAG/rt-dvb-i-application), [rt-dvb-i-android-application](https://github.com/5G-MAG/rt-dvb-i-android-application), [rt-dvb-i-application-provider](https://github.com/5G-MAG/rt-dvb-i-application-provider), [rt-dvb-i-examples](https://github.com/5G-MAG/rt-dvb-i-examples) and [rt-5gms-application](https://github.com/5G-MAG/rt-5gms-application) |

## Introduction

The DVB-I Service List Registry: a DVB-I client queries it, and it answers with the Service List
Entry Points it knows. It is the discovery component used with the DVB-I client
(`rt-dvb-i-application`) and the Service List Server and Content Guide Server
(`rt-dvb-i-application-provider`).

## Specification

Built against **ETSI TS 103 770 V1.2.1 (2024-09)**.

What the specification defines, and what this repository implements and does not, is on the project
page: <https://www.5g-mag.com/reference-tools/dvb-i>

## Install dependencies

Node.js 20 or later, with npm.

## Downloading

```bash
cd ~
git clone https://github.com/5G-MAG/rt-dvb-i-service-list-registry.git
```

## Building

```bash
cd rt-dvb-i-service-list-registry
npm install
```

## Running

```bash
npm install
GENRE_CS_DIR=/srv/dvb-i/cs npm start   # http://localhost:7000/query
```

`GENRE_CS_DIR` is required (see [Configuration](#configuration)). Opening `http://localhost:7000/`
in a browser shows a read-only page from which the queries can be run. Example queries:

```
GET /query?TargetCountry=CHE
GET /query?TargetCountry=ITA&regulatorListFlag=true
GET /query?Delivery[]=dvb-dash&Delivery[]=dvb-t
GET /query?ProviderName=5G-MAG
```

With TLS:

```bash
HTTPS_KEY_PATH=/etc/tls/key.pem HTTPS_CERT_PATH=/etc/tls/cert.pem npm start   # https://<host>:7000/query
```

## Configuration

| Variable | Default | What it sets |
|---|---|---|
| `PORT` | `7000` | the port |
| `REGISTRY_PATH` | `registry.json` | the registry file: the service lists the registry offers |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug` |
| `HTTPS_KEY_PATH`, `HTTPS_CERT_PATH` | unset | a PEM private key and certificate; with both set, the registry serves HTTPS only. With neither, it serves plain HTTP and logs a warning. If only one is set, or either cannot be loaded, it does not start. |
| `GENRE_CS_DIR` | required | a directory holding the classification schemes that `Genre` values are checked against |

The entries the registry serves are edited in `registry.json`.

`GENRE_CS_DIR` must hold these three files, which are not carried in this repository; obtain them
from their publishers and keep them outside the working tree:

| File | Source |
|---|---|
| `ContentCS.xml` | TV-Anytime metadata, ETSI TS 102 822-3-1 |
| `FormatCS.xml` | TV-Anytime metadata, ETSI TS 102 822-3-1 |
| `DVBContentSubjectCS-2019.xml` | the electronic attachment of ETSI TS 103 770 |

```bash
GENRE_CS_DIR=/srv/dvb-i/cs npm start
```

## Development

```bash
npm test                                                   # unit tests, XSD skips without schemas
DVBI_SCHEMAS=~/.local/share/dvb-i-schemas/etsi npm test     # with conformance checking
GENRE_CS_DIR=~/.local/share/dvb-i-schemas/etsi npm test     # also with the real Genre schemes
```

No schema or classification scheme file is carried in this repository. Without `DVBI_SCHEMAS` the
XSD check skips, and without `GENRE_CS_DIR` the one test that reads the real schemes skips; the CI
workflow, `.github/workflows/test.yml`, runs `npm test` without either.

## Contributing

Contributions are welcome. How to raise an issue, fork the repository and open a pull request, and
the Contributor License Agreement required before code can be merged, are described at
<https://www.5g-mag.com/contributing>.

## License

Distributed under the 5G-MAG Public License v1.0. See [LICENSE](LICENSE).
