package smarthttp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
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
func HandleReceivePack(w http.ResponseWriter, r *http.Request, reposRoot, owner, repo, apiURL string) {
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
	waitErr := cmd.Wait()

	// If push completed successfully and apiURL is provided, notify API to check for CI
	if waitErr == nil && apiURL != "" {
		go triggerOnPushCI(apiURL, owner, repo)
	}
}

// triggerOnPushCI sends an asynchronous HTTP POST notification to GitPub API to trigger CI if configured
func triggerOnPushCI(apiURL, owner, repo string) {
	payload := map[string]string{
		"owner": owner,
		"repo":  repo,
	}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[CI Trigger] Failed to marshal push payload: %v", err)
		return
	}

	hookURL := fmt.Sprintf("%s/api/ci/internal/on-push", apiURL)
	resp, err := http.Post(hookURL, "application/json", bytes.NewBuffer(jsonBytes))
	if err != nil {
		log.Printf("[CI Trigger] Failed to notify API on-push hook at %s: %v", hookURL, err)
		return
	}
	defer resp.Body.Close()
	log.Printf("[CI Trigger] Push event for %s/%s delivered to %s (status: %d)", owner, repo, hookURL, resp.StatusCode)
}
