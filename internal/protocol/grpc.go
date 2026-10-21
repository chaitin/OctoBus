package protocol

import (
	"errors"
	"io"
	"time"

	"octobus/internal/domain"
	"octobus/internal/store"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/reflection/grpc_reflection_v1"
	"google.golang.org/grpc/status"
)

func GRPCServer(gateway *Gateway) *grpc.Server {
	srv := grpc.NewServer(grpc.ForceServerCodec(rawCodec{}), grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) (err error) {
		start := time.Now()
		method, ok := grpc.MethodFromServerStream(stream)
		if !ok {
			record := gateway.newGRPCAccessRecord(stream.Context(), "grpc", "")
			defer func() {
				gateway.finishGRPCAccessLog(start, record, err)
			}()
			return status.Error(codes.Internal, "missing gRPC method")
		}
		record := gateway.newGRPCAccessRecord(stream.Context(), "grpc", method)
		defer func() {
			gateway.finishGRPCAccessLog(start, record, err)
		}()
		item, err := gateway.findGRPCExposedMethod(stream.Context(), method)
		if err != nil {
			return err
		}
		record.Service = item.Service.ID
		if domain.EffectiveRuntimeMode(item.Service, item.Instance) == domain.RuntimeModeOnDemand && !item.Method.Unary {
			return status.Error(codes.Unimplemented, "streaming methods are not supported by on-demand runtime")
		}
		switch {
		case item.Method.Unary:
			return gateway.proxyUnaryStream(stream, item)
		case item.Method.ServerStreaming && !item.Method.ClientStreaming:
			return gateway.proxyServerStream(stream, item)
		case item.Method.ClientStreaming && !item.Method.ServerStreaming:
			return gateway.proxyClientStream(stream, item)
		case item.Method.ClientStreaming && item.Method.ServerStreaming:
			return gateway.proxyBidiStream(stream, item)
		default:
			return status.Error(codes.Internal, "unknown gRPC method type")
		}
	}))
	grpc_reflection_v1.RegisterServerReflectionServer(srv, &ReflectionServer{Store: gateway.Store, AccessLogger: gateway.AccessLogger, Logger: gateway.Logger})
	return srv
}

func (g *Gateway) proxyUnaryStream(stream grpc.ServerStream, item store.ExposedMethod) error {
	req := newRawFrame(nil)
	if err := stream.RecvMsg(req); err != nil {
		return err
	}
	resp, err := g.invokeRaw(stream.Context(), item, req.Bytes())
	if err != nil {
		return err
	}
	return stream.SendMsg(newRawFrame(resp))
}

// releaseStream drops a scale-to-zero request ref when a proxy returns by any
// path, including a client hangup that never touches the backend stream again.
// warmStream's release is idempotent, so this is safe alongside the
// per-message release on EOF and error.
func releaseStream(client grpc.ClientStream) {
	if releaser, ok := client.(interface{ Release() }); ok {
		releaser.Release()
	}
}

func (g *Gateway) proxyServerStream(stream grpc.ServerStream, item store.ExposedMethod) error {
	req := newRawFrame(nil)
	if err := stream.RecvMsg(req); err != nil {
		return err
	}
	client, err := g.newBackendStream(stream.Context(), item)
	if err != nil {
		return err
	}
	defer releaseStream(client)
	if err := client.SendMsg(req); err != nil {
		return err
	}
	if err := client.CloseSend(); err != nil {
		return err
	}
	for {
		resp := newRawFrame(nil)
		err := client.RecvMsg(resp)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		if err := stream.SendMsg(resp); err != nil {
			return err
		}
	}
}

func (g *Gateway) proxyClientStream(stream grpc.ServerStream, item store.ExposedMethod) error {
	client, err := g.newBackendStream(stream.Context(), item)
	if err != nil {
		return err
	}
	defer releaseStream(client)
	for {
		req := newRawFrame(nil)
		err := stream.RecvMsg(req)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		if err := client.SendMsg(req); err != nil {
			return err
		}
	}
	if err := client.CloseSend(); err != nil {
		return err
	}
	resp := newRawFrame(nil)
	if err := client.RecvMsg(resp); err != nil {
		return err
	}
	if err := stream.SendMsg(resp); err != nil {
		return err
	}
	extra := newRawFrame(nil)
	if err := client.RecvMsg(extra); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

func (g *Gateway) proxyBidiStream(stream grpc.ServerStream, item store.ExposedMethod) error {
	client, err := g.newBackendStream(stream.Context(), item)
	if err != nil {
		return err
	}
	defer releaseStream(client)
	errc := make(chan error, 2)
	go func() {
		for {
			req := newRawFrame(nil)
			err := stream.RecvMsg(req)
			if errors.Is(err, io.EOF) {
				errc <- client.CloseSend()
				return
			}
			if err != nil {
				errc <- err
				return
			}
			if err := client.SendMsg(req); err != nil {
				errc <- err
				return
			}
		}
	}()
	go func() {
		for {
			resp := newRawFrame(nil)
			err := client.RecvMsg(resp)
			if errors.Is(err, io.EOF) {
				errc <- nil
				return
			}
			if err != nil {
				errc <- err
				return
			}
			if err := stream.SendMsg(resp); err != nil {
				errc <- err
				return
			}
		}
	}()
	for i := 0; i < 2; i++ {
		if err := <-errc; err != nil {
			return err
		}
	}
	return nil
}
