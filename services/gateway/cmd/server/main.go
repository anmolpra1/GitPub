package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
	"github.com/anmolpra1/gitpub-gateway/internal/smarthttp"
)

func main() {
	// Load .env file if it exists
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	reposRoot := os.Getenv("REPOS_ROOT")
	if reposRoot == "" {
		// Default path to the data folder relative to the monorepo root
		reposRoot = filepath.Join("..", "..", "data", "repos")
	}

	// Ensure absolute path for repositories root
	absReposRoot, err := filepath.Abs(reposRoot)
	if err == nil {
		reposRoot = absReposRoot
	}

	apiURL := os.Getenv("API_URL")
	if apiURL == "" {
		apiURL = "http://localhost:8080"
	}

	log.Printf("Starting GitPub Protocol Gateway on port %s", port)
	log.Printf("Repositories root directory set to: %s", reposRoot)
	log.Printf("REST API URL set to: %s", apiURL)

	// Single central handler that parses routes manually for backward & forward compatibility
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[%s] %s", r.Method, r.URL.Path)

		// Clean and split URL path
		// Expected path formats:
		// 1. /:owner/:repo/info/refs
		// 2. /:owner/:repo/git-upload-pack
		// 3. /:owner/:repo/git-receive-pack
		path := strings.Trim(r.URL.Path, "/")
		parts := strings.Split(path, "/")

		if len(parts) < 3 {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}

		owner := parts[0]
		repo := parts[1]
		action := strings.Join(parts[2:], "/")

		// Ensure repo ends with .git for directory matching
		if !strings.HasSuffix(repo, ".git") {
			repo = repo + ".git"
		}

		// Determine Git action for authentication and authorization check
		var gitAction string
		switch action {
		case "info/refs":
			service := r.URL.Query().Get("service")
			if service == "git-upload-pack" {
				gitAction = "pull"
			} else if service == "git-receive-pack" {
				gitAction = "push"
			} else {
				http.Error(w, "Unsupported service parameter", http.StatusForbidden)
				return
			}
		case "git-upload-pack":
			gitAction = "pull"
		case "git-receive-pack":
			gitAction = "push"
		default:
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}

		// Perform authentication and RBAC checks via REST API
		if !smarthttp.VerifyGitAuth(w, r, apiURL, owner, repo, gitAction) {
			return
		}

		switch action {
		case "info/refs":
			if r.Method != http.MethodGet {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			service := r.URL.Query().Get("service")
			if service == "git-upload-pack" {
				smarthttp.HandleUploadPackInfoRefs(w, reposRoot, owner, repo)
			} else if service == "git-receive-pack" {
				smarthttp.HandleReceivePackInfoRefs(w, reposRoot, owner, repo)
			}

		case "git-upload-pack":
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			smarthttp.HandleUploadPack(w, r, reposRoot, owner, repo)

		case "git-receive-pack":
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			smarthttp.HandleReceivePack(w, r, reposRoot, owner, repo)
		}
	})

	log.Fatal(http.ListenAndServe(":"+port, nil))
}
