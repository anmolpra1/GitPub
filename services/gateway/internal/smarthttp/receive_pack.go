package smarthttp

import (
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
)

// HandleReceivePackInfoRefs handles GET requests for /info/refs?service=git-receive-pack
func HandleReceivePackInfoRefs(w http.ResponseWriter, reposRoot, owner, repo string) {
	repoPath := filepath.Join(reposRoot, owner, repo)

	w.Header().Set("Content-Type", "application/x-git-receive-pack-advertisement")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	// Write packet-line header for the service
	header := "# service=git-receive-pack\n"
	fmt.Fprintf(w, "%04x%s0000", len(header)+4, header)

	// Run git receive-pack --stateless-rpc --advertise-refs
	cmd := exec.Command("git", "receive-pack", "--stateless-rpc", "--advertise-refs", repoPath)
	cmd.Stdout = w
	cmd.Stderr = w
	_ = cmd.Run()
}

// HandleReceivePack handles POST requests for /git-receive-pack (git push)
func HandleReceivePack(w http.ResponseWriter, r *http.Request, reposRoot, owner, repo string) {
	repoPath := filepath.Join(reposRoot, owner, repo)

	w.Header().Set("Content-Type", "application/x-git-receive-pack-result")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	// Pipe HTTP request body (push packfile payload) directly into git receive-pack stdin
	// and pipe its stdout directly back to the client response.
	cmd := exec.Command("git", "receive-pack", "--stateless-rpc", repoPath)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return
	}

	cmd.Stderr = w // Send error output to client or log it

	if err := cmd.Start(); err != nil {
		return
	}

	// Stream request body to git process stdin in the background
	go func() {
		defer stdin.Close()
		_, _ = io.Copy(stdin, r.Body)
	}()

	// Stream stdout of git process back to HTTP response
	_, _ = io.Copy(w, stdout)
	_ = cmd.Wait()
}
