package smarthttp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
)

// AuthPayload represents the request payload sent to the Node.js auth verification API
type AuthPayload struct {
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	Owner    string `json:"owner"`
	Repo     string `json:"repo"`
	Action   string `json:"action"`
}

// AuthResponse represents the response format of the verification API
type AuthResponse struct {
	Authenticated bool   `json:"authenticated"`
	Authorized    bool   `json:"authorized"`
	Error         string `json:"error,omitempty"`
}

// VerifyGitAuth checks if the request is authenticated and authorized for the action
func VerifyGitAuth(w http.ResponseWriter, r *http.Request, apiURL, owner, repo, action string) bool {
	username, password, hasAuth := r.BasicAuth()

	payload := AuthPayload{
		Owner:  owner,
		Repo:   repo,
		Action: action,
	}

	if hasAuth {
		payload.Username = username
		payload.Password = password
	}

	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Auth] Error encoding auth request payload: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return false
	}

	verifyURL := fmt.Sprintf("%s/api/repos/verify-git-auth", apiURL)
	resp, err := http.Post(verifyURL, "application/json", bytes.NewBuffer(jsonBytes))
	if err != nil {
		log.Printf("[Auth] Error sending verification request to API: %v", err)
		http.Error(w, "Service Unavailable", http.StatusServiceUnavailable)
		return false
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[Auth] Error reading API verification response: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return false
	}

	var authResp AuthResponse
	if err := json.Unmarshal(bodyBytes, &authResp); err != nil {
		// If we couldn't parse it but got a non-200 code, check specific codes
		if resp.StatusCode == http.StatusUnauthorized {
			w.Header().Set("WWW-Authenticate", `Basic realm="GitPub"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return false
		}
		if resp.StatusCode == http.StatusForbidden {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return false
		}
		if resp.StatusCode == http.StatusNotFound {
			http.Error(w, "Not Found", http.StatusNotFound)
			return false
		}
		log.Printf("[Auth] Error decoding response json: %v, raw response: %s", err, string(bodyBytes))
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return false
	}

	if authResp.Authorized {
		return true
	}

	// Not authorized. Prompt for credentials or return access forbidden
	if resp.StatusCode == http.StatusUnauthorized || (!authResp.Authenticated && !authResp.Authorized) {
		w.Header().Set("WWW-Authenticate", `Basic realm="GitPub"`)
		errorMessage := "Unauthorized"
		if authResp.Error != "" {
			errorMessage = authResp.Error
		}
		http.Error(w, errorMessage, http.StatusUnauthorized)
		return false
	}

	// Forbidden (e.g. valid credentials but not owner)
	errorMessage := "Forbidden"
	if authResp.Error != "" {
		errorMessage = authResp.Error
	}
	http.Error(w, errorMessage, http.StatusForbidden)
	return false
}
