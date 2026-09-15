# Docker Image

The OctoBus image is built from `ubuntu:26.04` and includes the `octobus`
binary plus the runtime tools used by service package workflows:

- Go from Ubuntu's repositories for the build stage, using Go's automatic
  toolchain selection when module dependencies require a newer 1.26 patch
- `node` and `npm` for JavaScript service packages
- `protoc` for descriptor compilation during service import
- `git` for HTTPS Git service sources
- `ca-certificates` and `curl` for TLS access and container health checks

Build the image from the repository root:

```bash
docker build -f docker/Dockerfile -t octobus:dev .
```

Run the daemon:

```bash
docker run --rm -p 9000:9000 -v octobus-data:/var/lib/octobus octobus:dev
```

When using a host bind mount instead of a named volume, make sure the mounted
directory is owned by the non-root `octobus` user. The UID and GID are image
details, so query them from the exact image you are going to run and apply them
to the host directory:

```bash
mkdir -p ./octobus-data
docker run --rm --entrypoint id octobus:dev -u octobus
docker run --rm --entrypoint id octobus:dev -g octobus
sudo chown -R <uid>:<gid> ./octobus-data
docker run --rm -p 9000:9000 \
  -v "$PWD/octobus-data:/var/lib/octobus" \
  octobus:dev
```

The image defaults to:

```text
OCTOBUS_ADDR=0.0.0.0:9000
OCTOBUS_DATA_DIR=/var/lib/octobus
```

Run CLI commands against the daemon with another container on the same network,
or from the host through the published port:

```bash
docker run --rm --network host octobus:dev status --addr 127.0.0.1:9000
```

For a complete local validation flow that builds the image, starts the daemon,
imports a calculator service fixture using the local SDK package, creates an
instance and capset, then invokes the service through Connect RPC:

```bash
docker/smoke.sh octobus:dev
```
