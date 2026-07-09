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

package org.platformcollective.app;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Main activity for the Huly mobile app.
 * Implements native error handling for WebView load failures and network monitoring.
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "HulyMainActivity";
    private static final int REQUEST_POST_NOTIFICATIONS = 1001;

    // Error codes we handle
    private static final int ERROR_HOST_LOOKUP = -2;      // ERR_NAME_NOT_RESOLVED
    private static final int ERROR_CONNECT = -6;          // ERR_CONNECTION_REFUSED
    private static final int ERROR_TIMEOUT = -8;          // ERR_TIMED_OUT
    private static final int ERROR_IO = -7;               // ERR_IO_PENDING
    private static final int ERROR_UNKNOWN = -1;          // ERROR_UNKNOWN

    private View errorView;
    private boolean isShowingError = false;
    private boolean hasLoadedSuccessfully = false;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Set up the custom WebViewClient after the bridge is ready
        Bridge bridge = this.getBridge();
        if (bridge != null) {
            WebView webView = bridge.getWebView();
            if (webView != null) {
                webView.setWebViewClient(new HulyWebViewClient(bridge));
                setupDownloadListener(webView);
            }
        }

        // Set up error view
        setupErrorView();

        // Set up network monitoring
        setupNetworkMonitoring();

        // Android 13+ requires a runtime grant before any notification can be shown
        requestNotificationPermissionIfNeeded();

        // Check initial connectivity
        if (!isNetworkAvailable()) {
            Log.w(TAG, "No network available on startup");
            // Don't show error immediately, let WebView try to load first
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        // Unregister network callback
        if (networkCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                cm.unregisterNetworkCallback(networkCallback);
            }
        }
    }

    /**
     * Ask for notification permission on Android 13+. Declared in the manifest,
     * but notifications stay silently blocked until the user grants it at runtime.
     */
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_POST_NOTIFICATIONS);
        }
    }

    /**
     * Route WebView downloads (attachments, exports) to the system DownloadManager.
     * The WebView itself silently ignores downloads without a listener.
     * blob:/data: URLs cannot go through DownloadManager and are not handled here.
     */
    private void setupDownloadListener(WebView webView) {
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (!URLUtil.isNetworkUrl(url)) {
                Log.w(TAG, "Unsupported download url scheme: " + url);
                return;
            }
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) {
                    request.addRequestHeader("Cookie", cookies);
                }
                request.addRequestHeader("User-Agent", userAgent);
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) {
                    dm.enqueue(request);
                    Toast.makeText(this, getString(R.string.download_started, fileName), Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to start download: " + url, e);
            }
        });
    }

    /**
     * Set up the error view that overlays the WebView when errors occur.
     */
    private void setupErrorView() {
        errorView = getLayoutInflater().inflate(R.layout.error_screen, null);

        Button retryButton = errorView.findViewById(R.id.retryButton);
        if (retryButton != null) {
            retryButton.setOnClickListener(v -> retryLoading());
        }

        // Add error view to the content but keep it hidden
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        );

        // Find the root view and add error view
        View rootView = findViewById(android.R.id.content);
        if (rootView instanceof FrameLayout) {
            ((FrameLayout) rootView).addView(errorView, params);
        }

        errorView.setVisibility(View.GONE);
    }

    /**
     * Set up network connectivity monitoring.
     */
    private void setupNetworkMonitoring() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;

        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(@NonNull Network network) {
                Log.d(TAG, "Network available");
                // If we're showing error and network is back, offer retry
                runOnUiThread(() -> {
                    if (isShowingError) {
                        updateErrorMessage(getString(R.string.error_network_restored));
                    }
                });
            }

            @Override
            public void onLost(@NonNull Network network) {
                Log.d(TAG, "Network lost");
                // Only show error if we haven't loaded successfully
                runOnUiThread(() -> {
                    if (!hasLoadedSuccessfully) {
                        showErrorScreen(getString(R.string.error_no_network));
                    }
                });
            }
        };

        NetworkRequest request = new NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build();

        cm.registerNetworkCallback(request, networkCallback);
    }

    /**
     * Check if network is currently available.
     */
    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;

        Network network = cm.getActiveNetwork();
        if (network == null) return false;

        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /**
     * Show the native error screen.
     */
    private void showErrorScreen(String message) {
        if (errorView == null) return;

        isShowingError = true;

        TextView messageView = errorView.findViewById(R.id.errorMessage);
        if (messageView != null && message != null) {
            messageView.setText(message);
        }

        errorView.setVisibility(View.VISIBLE);

        // Hide WebView
        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setVisibility(View.INVISIBLE);
        }
    }

    /**
     * Hide the error screen and show WebView.
     */
    private void hideErrorScreen() {
        if (errorView == null) return;

        isShowingError = false;
        errorView.setVisibility(View.GONE);

        // Show WebView
        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setVisibility(View.VISIBLE);
        }
    }

    /**
     * Update the error message without changing visibility.
     */
    private void updateErrorMessage(String message) {
        if (errorView == null) return;

        TextView messageView = errorView.findViewById(R.id.errorMessage);
        if (messageView != null && message != null) {
            messageView.setText(message);
        }
    }

    /**
     * Retry loading the WebView content.
     */
    private void retryLoading() {
        Log.d(TAG, "Retrying WebView load");

        hideErrorScreen();
        hasLoadedSuccessfully = false;

        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().reload();
        }
    }

    /**
     * Custom WebViewClient that intercepts load errors and shows native error UI.
     */
    private class HulyWebViewClient extends BridgeWebViewClient {
        public HulyWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            Log.d(TAG, "Page started loading: " + url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            Log.d(TAG, "Page finished loading: " + url);

            // Mark as successfully loaded
            hasLoadedSuccessfully = true;

            // Hide error screen if it was showing
            runOnUiThread(() -> hideErrorScreen());
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);

            // Only handle errors for the main frame
            if (request.isForMainFrame()) {
                int errorCode = error.getErrorCode();
                String description = error.getDescription().toString();
                String url = request.getUrl().toString();

                Log.e(TAG, "WebView error: code=" + errorCode + ", desc=" + description + ", url=" + url);

                // Handle connection-related errors
                if (isConnectionError(errorCode)) {
                    runOnUiThread(() -> {
                        String message = getErrorMessage(errorCode);
                        showErrorScreen(message);
                    });
                }
            }
        }

        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            super.onReceivedError(view, errorCode, description, failingUrl);

            Log.e(TAG, "WebView error (legacy): code=" + errorCode + ", desc=" + description + ", url=" + failingUrl);

            // Handle connection-related errors
            if (isConnectionError(errorCode)) {
                runOnUiThread(() -> {
                    String message = getErrorMessage(errorCode);
                    showErrorScreen(message);
                });
            }
        }

        /**
         * Check if the error code is a connection-related error.
         */
        private boolean isConnectionError(int errorCode) {
            return errorCode == ERROR_HOST_LOOKUP ||
                   errorCode == ERROR_CONNECT ||
                   errorCode == ERROR_TIMEOUT ||
                   errorCode == ERROR_IO ||
                   errorCode == ERROR_UNKNOWN;
        }

        /**
         * Get a user-friendly error message for the error code.
         */
        private String getErrorMessage(int errorCode) {
            switch (errorCode) {
                case ERROR_HOST_LOOKUP:
                case ERROR_CONNECT:
                    return getString(R.string.error_server_unavailable);
                case ERROR_TIMEOUT:
                    return getString(R.string.error_connection_timeout);
                default:
                    if (!isNetworkAvailable()) {
                        return getString(R.string.error_no_network);
                    }
                    return getString(R.string.error_server_unavailable);
            }
        }
    }
}
