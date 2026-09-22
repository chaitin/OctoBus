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
docker run --rm \
  -p 9000:9000 \
  -e OCTOBUS_BOOTSTRAP_ADMIN_TOKEN=... \
  -v octobus-data:/var/lib/octobus \
  octobus:dev
```

The image listens on `0.0.0.0:9000` by default, so do not pass `serve --dev`
with a published port: `--dev` only starts on a loopback address. Local
development on the host should use `octobus serve --dev` instead.

Do not reuse a data volume that was first started with `--dev`. That writes
the well-known development token into the store; later starts print a warning
and `OCTOBUS_BOOTSTRAP_ADMIN_TOKEN` will not replace it. A leftover
development token is refused on a non-loopback listen address. Use a fresh
volume for production. Do not bake a default token into the image.

When using a host bind mount instead of a named volume, make sure the mounted
directory is writable by the container user.

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
