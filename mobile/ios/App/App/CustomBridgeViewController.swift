//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import UIKit
import Capacitor
import WebKit
import Network

/**
 * Custom BridgeViewController that handles WebView load errors and shows native error UI.
 */
class CustomBridgeViewController: CAPBridgeViewController {
    
    // MARK: - Properties
    
    private var errorView: UIView?
    private var errorMessageLabel: UILabel?
    private var isShowingError = false
    private var hasLoadedSuccessfully = false
    private let networkMonitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "NetworkMonitor")
    private var isNetworkAvailable = true
    
    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        // Set up network monitoring
        setupNetworkMonitoring()
        
        // Set up error view
        setupErrorView()
        
        // Set navigation delegate
        webView?.navigationDelegate = self
    }
    
    deinit {
        networkMonitor.cancel()
    }
    
    // MARK: - Network Monitoring
    
    private func setupNetworkMonitoring() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                let wasAvailable = self?.isNetworkAvailable ?? true
                self?.isNetworkAvailable = path.status == .satisfied
                
                if path.status == .satisfied {
                    print("Network: Available")
                    if self?.isShowingError == true {
                        self?.updateErrorMessage("Network connection restored.\nTap Retry to continue.")
                    }
                } else {
                    print("Network: Unavailable")
                    if self?.hasLoadedSuccessfully == false {
                        self?.showErrorScreen(message: "No internet connection.\nPlease check your network settings and try again.")
                    }
                }
            }
        }
        networkMonitor.start(queue: monitorQueue)
    }
    
    // MARK: - Error View Setup
    
    private func setupErrorView() {
        // Create error view container
        let containerView = UIView()
        containerView.backgroundColor = UIColor(red: 31/255, green: 41/255, blue: 55/255, alpha: 1.0) // #1F2937
        containerView.translatesAutoresizingMaskIntoConstraints = false
        containerView.isHidden = true
        
        // Create stack view for content
        let stackView = UIStackView()
        stackView.axis = .vertical
        stackView.alignment = .center
        stackView.spacing = 16
        stackView.translatesAutoresizingMaskIntoConstraints = false
        
        // App logo
        let logoImageView = UIImageView()
        if let appIcon = UIImage(named: "AppIcon") ?? UIImage(named: "Splash") {
            logoImageView.image = appIcon
        }
        logoImageView.contentMode = .scaleAspectFit
        logoImageView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            logoImageView.widthAnchor.constraint(equalToConstant: 120),
            logoImageView.heightAnchor.constraint(equalToConstant: 120)
        ])
        
        // Error title
        let titleLabel = UILabel()
        titleLabel.text = "Connection Error"
        titleLabel.font = UIFont.boldSystemFont(ofSize: 24)
        titleLabel.textColor = .white
        titleLabel.textAlignment = .center
        
        // Error message
        let messageLabel = UILabel()
        messageLabel.text = "Unable to connect to the server.\nPlease check if the server is running and try again."
        messageLabel.font = UIFont.systemFont(ofSize: 16)
        messageLabel.textColor = UIColor(red: 156/255, green: 163/255, blue: 175/255, alpha: 1.0) // #9CA3AF
        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 0
        self.errorMessageLabel = messageLabel
        
        // Retry button
        let retryButton = UIButton(type: .system)
        retryButton.setTitle("Retry", for: .normal)
        retryButton.setTitleColor(.white, for: .normal)
        retryButton.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .medium)
        retryButton.backgroundColor = UIColor(red: 79/255, green: 70/255, blue: 229/255, alpha: 1.0) // #4F46E5
        retryButton.layer.cornerRadius = 8
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.addTarget(self, action: #selector(retryButtonTapped), for: .touchUpInside)
        NSLayoutConstraint.activate([
            retryButton.widthAnchor.constraint(equalToConstant: 200),
            retryButton.heightAnchor.constraint(equalToConstant: 48)
        ])
        
        // Add views to stack
        stackView.addArrangedSubview(logoImageView)
        stackView.addArrangedSubview(titleLabel)
        stackView.addArrangedSubview(messageLabel)
        stackView.addArrangedSubview(retryButton)
        
        // Set custom spacing
        stackView.setCustomSpacing(32, after: logoImageView)
        stackView.setCustomSpacing(32, after: messageLabel)
        
        // Add stack to container
        containerView.addSubview(stackView)
        
        // Add container to view
        view.addSubview(containerView)
        
        // Set up constraints
        NSLayoutConstraint.activate([
            containerView.topAnchor.constraint(equalTo: view.topAnchor),
            containerView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            containerView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            containerView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            
            stackView.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            stackView.centerYAnchor.constraint(equalTo: containerView.centerYAnchor),
            stackView.leadingAnchor.constraint(greaterThanOrEqualTo: containerView.leadingAnchor, constant: 32),
            stackView.trailingAnchor.constraint(lessThanOrEqualTo: containerView.trailingAnchor, constant: -32)
        ])
        
        self.errorView = containerView
    }
    
    // MARK: - Error Screen Management
    
    private func showErrorScreen(message: String) {
        guard let errorView = errorView else { return }
        
        isShowingError = true
        errorMessageLabel?.text = message
        
        errorView.isHidden = false
        webView?.isHidden = true
    }
    
    private func hideErrorScreen() {
        guard let errorView = errorView else { return }
        
        isShowingError = false
        errorView.isHidden = true
        webView?.isHidden = false
    }
    
    private func updateErrorMessage(_ message: String) {
        errorMessageLabel?.text = message
    }
    
    // MARK: - Actions
    
    @objc private func retryButtonTapped() {
        print("Retry button tapped")
        hideErrorScreen()
        hasLoadedSuccessfully = false
        webView?.reload()
    }
    
    // MARK: - Error Message Helpers
    
    private func getErrorMessage(for error: Error) -> String {
        let nsError = error as NSError
        
        switch nsError.code {
        case NSURLErrorCannotConnectToHost, // -1004
             NSURLErrorCannotFindHost:      // -1003
            return "Unable to connect to the server.\nPlease check if the server is running and try again."
            
        case NSURLErrorNotConnectedToInternet: // -1009
            return "No internet connection.\nPlease check your network settings and try again."
            
        case NSURLErrorTimedOut: // -1001
            return "Connection timed out.\nPlease check your network and try again."
            
        default:
            if !isNetworkAvailable {
                return "No internet connection.\nPlease check your network settings and try again."
            }
            return "Unable to connect to the server.\nPlease check if the server is running and try again."
        }
    }
    
    private func isConnectionError(_ error: Error) -> Bool {
        let nsError = error as NSError
        
        // Ignore cancelled navigation (-999)
        if nsError.code == NSURLErrorCancelled {
            return false
        }
        
        let connectionErrorCodes = [
            NSURLErrorCannotConnectToHost,      // -1004
            NSURLErrorCannotFindHost,           // -1003
            NSURLErrorNotConnectedToInternet,   // -1009
            NSURLErrorTimedOut,                 // -1001
            NSURLErrorNetworkConnectionLost,    // -1005
            NSURLErrorDNSLookupFailed,          // -1006
            NSURLErrorResourceUnavailable,      // -1008
            NSURLErrorSecureConnectionFailed    // -1200
        ]
        
        return connectionErrorCodes.contains(nsError.code)
    }
}

// MARK: - WKNavigationDelegate

extension CustomBridgeViewController: WKNavigationDelegate {
    
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        print("WebView: Started provisional navigation")
    }
    
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("WebView: Finished navigation")
        hasLoadedSuccessfully = true
        hideErrorScreen()
    }
    
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("WebView: Failed provisional navigation - \(error.localizedDescription)")
        
        if isConnectionError(error) {
            let message = getErrorMessage(for: error)
            showErrorScreen(message: message)
        }
    }
    
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("WebView: Failed navigation - \(error.localizedDescription)")
        
        if isConnectionError(error) {
            let message = getErrorMessage(for: error)
            showErrorScreen(message: message)
        }
    }
    
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Allow all navigation by default
        decisionHandler(.allow)
    }
}
