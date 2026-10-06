package protocol

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

func TestGatewayCacheEntriesExpireAndInvalidateTogether(t *testing.T) {
	gateway := &Gateway{
		mcpToolsCache:  map[string][]map[string]any{"expired": {{"name": "tool"}}},
		connectCache:   map[string]http.Handler{"expired": http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})},
		mcpCacheAt:     map[string]time.Time{"expired": time.Now().Add(-gatewayCacheTTL)},
		connectCacheAt: map[string]time.Time{"expired": time.Now().Add(-gatewayCacheTTL)},
	}
	gateway.mu.Lock()
	gateway.evictExpiredCachesLocked(time.Now())
	gateway.mu.Unlock()
	if len(gateway.mcpToolsCache) != 0 || len(gateway.connectCache) != 0 {
		t.Fatalf("expired gateway cache entries remain: mcp=%d connect=%d", len(gateway.mcpToolsCache), len(gateway.connectCache))
	}
}

func TestGatewayPruneRemovesOldestEntriesWithinCapacity(t *testing.T) {
	gateway := &Gateway{mcpToolsCache: make(map[string][]map[string]any), mcpCacheAt: make(map[string]time.Time)}
	for i := 0; i < gatewayCacheMaxEntries+1; i++ {
		key := fmt.Sprintf("key-%d", i)
		gateway.mcpToolsCache[key] = []map[string]any{{"name": key}}
		gateway.mcpCacheAt[key] = time.Unix(int64(i), 0)
	}
	gateway.pruneGatewayCachesLocked()
	if len(gateway.mcpToolsCache) != gatewayCacheMaxEntries {
		t.Fatalf("cache entries = %d, want %d", len(gateway.mcpToolsCache), gatewayCacheMaxEntries)
	}
	if _, ok := gateway.mcpToolsCache["key-0"]; ok {
		t.Fatal("oldest cache entry was not pruned")
	}
}

func TestGatewayPruneAdvancesWhenTimestampMetadataIsMissing(t *testing.T) {
	gateway := &Gateway{mcpToolsCache: make(map[string][]map[string]any)}
	for i := 0; i < gatewayCacheMaxEntries+1; i++ {
		gateway.mcpToolsCache[fmt.Sprintf("key-%d", i)] = nil
	}
	gateway.pruneGatewayCachesLocked()
	if len(gateway.mcpToolsCache) != gatewayCacheMaxEntries {
		t.Fatalf("cache entries = %d, want %d", len(gateway.mcpToolsCache), gatewayCacheMaxEntries)
	}
}

func TestGatewayInstanceInvalidationClearsSchemaCaches(t *testing.T) {
	gateway := &Gateway{
		mcpToolsCache:  map[string][]map[string]any{"cached": {{"name": "tool"}}},
		connectCache:   map[string]http.Handler{"cached": http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})},
		mcpCacheAt:     map[string]time.Time{"cached": time.Now()},
		connectCacheAt: map[string]time.Time{"cached": time.Now()},
	}
	gateway.InvalidateInstance("missing-instance")
	if len(gateway.mcpToolsCache) != 0 || len(gateway.connectCache) != 0 {
		t.Fatal("instance invalidation left stale schema caches")
	}
}
