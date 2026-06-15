FROM ubuntu:26.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive \
	GOTOOLCHAIN=auto
WORKDIR /src

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
		git \
		golang-go \
		make \
		nodejs \
		npm \
		protobuf-compiler \
	&& rm -rf /var/lib/apt/lists/*

COPY go.mod go.sum ./
RUN go mod download

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

FROM ubuntu:26.04

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
