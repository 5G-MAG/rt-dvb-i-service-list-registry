<h1 align="center">DVB-I Service List Registry</h1>
<p align="center">
  <img src="https://img.shields.io/badge/Status-Under_Development-yellow" alt="Under Development">
</p>

## Introduction

A DVB-I client has to find service lists before it can show anything. The Service List Registry is
the component it asks. ETSI TS 103 770 V1.2.1 clause 5.1.3.2 defines it as an HTTP endpoint at a
known URL that, queried, returns a list of Service List Entry Points.

It is the third component of the architecture in clause 4.1 of that specification, alongside the
Service List Server and Content Guide Server (`rt-dvb-i-application-provider`) and the DVB-I client
(`rt-dvb-i-application`). Without it, a client either has a service list URL typed into it by hand
or depends on somebody else's registry.

## Running

```bash
npm install
npm start           # http://localhost:7000/query
```

`PORT` changes the port, `REGISTRY_PATH` points at a different registry file, `LOG_LEVEL` is one of
`error`, `warn`, `info` (default) or `debug`.

## The page at `/`

Opening the registry in a browser shows what it offers and lets you run the queries of clause
5.1.3.2 against it. It is **read only**. There is no editing, and that is deliberate: clause 5.1.3.2
puts how a registry collects and stores its information out of scope, so an editing interface would
implement nothing specified while giving a discovery endpoint the one thing it otherwise lacks, a
way to change its contents over the network.

Registration is by editing `registry.json`.

## Querying it

```
GET /query?TargetCountry=CHE
GET /query?TargetCountry=ITA&regulatorListFlag=true
GET /query?Delivery[]=dash&Delivery[]=dvb-t
GET /query?ProviderName=5G-MAG
```

The parameters are those clause 5.1.3.2 lists, in the order it presents them: `TargetCountry`,
`regulatorListFlag`, `Delivery`, `Language`, `Genre`, `ProviderName`, `inlineImages`. Repeated
values use square brackets, `TargetCountry[]=AUT&TargetCountry[]=DEU`, and the clause requires them
to be read as alternatives: values for one parameter are OR, different parameters narrow together.

A query naming an unknown parameter, or an invalid value, is refused with 400, as the clause
requires. A request URL over 2 048 characters is refused with 414, which is the limit that clause
sets. A query matching nothing returns a valid document with no offerings rather than an error.

## What it serves

`registry.json` is what the registry knows. The specification leaves how a registry collects and
stores this out of scope, so a file is as valid as a database and easier to read in a reference
implementation. Each entry names the list, its URLs, the delivery types it offers, the countries
and languages it targets, and whether it is a regulator's list.

The response is a `ServiceListEntryPoints` document in `urn:dvb:metadata:servicelistdiscovery:2024`,
per `dvbi_service_list_discovery_v1.6.xsd`, which ships in the electronic attachment archive
accompanying TS 103 770 (annex B lists it).

One trap worth knowing if you extend it: `ServiceListOffering` is declared by the discovery schema
but carries a type from `dvbi_types_v1.0.xsd`, so all of its children belong to the
`servicediscovery-types` namespace rather than the discovery one. Emitting them unprefixed produces
a document that looks right and fails validation.

## Tests

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

## Limitations

- Registration is by editing `registry.json`. The M interface of clause 4.1, by which a provider
  registers its own entry points, is not implemented.
- `Genre` and `inlineImages` are accepted and validated but do not change the response: no entry in
  the registry file carries genres, and images are never inlined.
- Server-side region selection (clause 5.6.4) is not implemented; `SRSSupport` is not advertised.

## License

No licence file has been added to this repository yet, so no licence is granted. Add one before
publishing or sharing it.
