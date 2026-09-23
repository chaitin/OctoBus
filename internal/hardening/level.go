package hardening

import "fmt"

// Level selects how much of a runtime's behavior is restricted. Levels are
// named after what enforces the restrictions, because the concrete mechanism
// differs per platform while the enforcement layer does not.
type Level string

const (
	// LevelOff launches runtimes exactly as the daemon itself runs.
	LevelOff Level = "off"
	// LevelNode restricts the Node.js process itself: an environment
	// allowlist, the permission model, a heap limit, and its own process
	// group. Node checks these inside its own process, so they guard against
	// mistakes in trusted code rather than isolate untrusted code.
	LevelNode Level = "node"
)

// ParseLevel resolves a configured value. An empty value means LevelOff; an
// unrecognized one is an error rather than a silent downgrade.
func ParseLevel(value string) (Level, error) {
	switch Level(value) {
	case "":
		return LevelOff, nil
	case LevelOff:
		return LevelOff, nil
	case LevelNode:
		return LevelNode, nil
	default:
		return "", fmt.Errorf("invalid runtime hardening level %q: want %s or %s", value, LevelOff, LevelNode)
	}
}
