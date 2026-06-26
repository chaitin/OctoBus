ARG REGISTRY_MIRROR=docker.io
ARG GO_VERSION=1.26.1

FROM ${REGISTRY_MIRROR}/library/golang:${GO_VERSION}-bookworm AS golang-toolchain

FROM ${REGISTRY_MIRROR}/library/ubuntu:26.04 AS builder

ARG GOPROXY=https://goproxy.cn,direct
ENV DEBIAN_FRONTEND=noninteractive \
    GOTOOLCHAIN=local \
    PATH=/usr/local/go/bin:${PATH}
WORKDIR /src

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    make \
    nodejs \
    npm \
    protobuf-compiler \
    libprotobuf-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=golang-toolchain /usr/local/go /usr/local/go
COPY go.mod go.sum ./
RUN go env -w GOPROXY="${GOPROXY}" && go mod download

COPY . .
ARG OCTOBUS_VERSION
ARG OCTOBUS_COMMIT
ARG OCTOBUS_BUILD_DATE
RUN bash ./scripts/build-octobus.sh /out/octobus \
    && if LC_ALL=C ldd /out/octobus 2>&1 | grep -q "not a dynamic executable"; then \
    true; \
    else \
    echo "/out/octobus is dynamically linked; expected a static binary" >&2; \
    LC_ALL=C ldd /out/octobus >&2; \
    exit 1; \
    fi

FROM ${REGISTRY_MIRROR}/library/ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive \
    OCTOBUS_ADDR=0.0.0.0:9000 \
    OCTOBUS_DATA_DIR=/var/lib/octobus

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    nodejs \
    npm \
    protobuf-compiler \
    libprotobuf-dev \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system octobus \
    && useradd --system --gid octobus --home-dir /var/lib/octobus --create-home --shell /usr/sbin/nologin octobus

COPY --from=builder /out/octobus /usr/local/bin/octobus

USER octobus
WORKDIR /var/lib/octobus
VOLUME ["/var/lib/octobus"]
EXPOSE 9000

ENTRYPOINT ["octobus"]
CMD ["serve"]
