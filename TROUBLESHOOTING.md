# UnderstandThisGame Extension - Troubleshooting Guide

## 🚨 Extension Not Working with Test File

### **Problem Identified:**
The extension was only configured to work on ESPN.com domains, but the test file runs on local file system or localhost.

### **✅ Fixes Applied:**

1. **Updated Manifest Permissions** (`manifest.json`):
   - Added support for `localhost`, `127.0.0.1`, and `file://` URLs
   - Extended content script matches to include test environments

2. **Enhanced Popup Validation** (`popup.js`):
   - Updated URL checking to allow test pages
   - Added better error messages and debugging

3. **Added Comprehensive Debugging**:
   - Console logging throughout the extension lifecycle
   - Error detection and reporting
   - Status tracking for troubleshooting

## 🧪 **Testing Steps:**

### **Step 1: Reload the Extension**
1. Go to `chrome://extensions/`
2. Find "UnderstandThisGame" extension
3. Click the refresh/reload button (🔄)
4. Ensure the extension is enabled

### **Step 2: Test with Test File**
1. Open `test-scraping.html` in your browser
2. Open browser console (F12)
3. Look for these messages:
   ```
   UnderstandThisGame: Content script loaded
   UnderstandThisGame: Constructor called
   UnderstandThisGame: Initializing...
   UnderstandThisGame: Overlay created and added to page
   ```

### **Step 3: Test Extension Popup**
1. Click the extension icon in the toolbar
2. You should see the popup with "Start Monitoring" button
3. If you see an error, check the console for details

### **Step 4: Test Overlay Functionality**
1. Click "Start Monitoring" in the popup
2. Look for the overlay window in the top-left corner
3. Test the buttons:
   - ✕ (Close) - should hide the overlay
   - − (Minimize) - should minimize/expand
   - 📋 (Log) - should toggle between status and log

## 🔍 **Debugging Console Messages:**

### **Expected Messages:**
```
Test page loaded
Current URL: file:///path/to/test-scraping.html
UnderstandThisGame: Content script loaded
UnderstandThisGame: Constructor called
UnderstandThisGame: Initializing...
UnderstandThisGame: Overlay created and added to page
Adding overlay event listeners...
Close button listener added
Minimize button listener added
Toggle log button listener added
All overlay event listeners added successfully
```

### **Error Messages to Look For:**
- `Chrome extension API not available` - Extension not loaded
- `Extension not loaded on this page` - Content script not injected
- `Close button not found` - DOM element missing
- `Chrome runtime error` - Communication issue

## 🛠️ **Common Issues & Solutions:**

### **Issue 1: Extension Not Loading**
**Symptoms:** No console messages from extension
**Solution:** 
- Reload the extension in `chrome://extensions/`
- Check if extension is enabled
- Verify manifest.json syntax

### **Issue 2: Popup Shows Error**
**Symptoms:** "Please navigate to ESPN.com or use the test page"
**Solution:**
- Make sure you're on a supported URL (localhost, file://, or espn.com)
- Check console for URL detection issues

### **Issue 3: Overlay Not Appearing**
**Symptoms:** No overlay window visible
**Solution:**
- Check console for overlay creation messages
- Look for CSS conflicts
- Verify DOM elements are being created

### **Issue 4: Buttons Not Working**
**Symptoms:** Clicking buttons does nothing
**Solution:**
- Check console for event listener messages
- Look for "Close button clicked" messages
- Verify event delegation is working

## 📋 **Quick Checklist:**

- [ ] Extension reloaded in `chrome://extensions/`
- [ ] Test file opened in browser
- [ ] Console shows extension loading messages
- [ ] Popup opens without errors
- [ ] Overlay appears when monitoring starts
- [ ] Close button works (fades out overlay)
- [ ] Minimize button works (collapses overlay)
- [ ] Log button works (toggles view)

## 🔧 **Advanced Debugging:**

### **Check Extension Status:**
```javascript
// In browser console
chrome.runtime.sendMessage({action: 'getStatus'}, console.log);
```

### **Manually Trigger Overlay:**
```javascript
// In browser console
chrome.runtime.sendMessage({action: 'showOverlay'});
```

### **Check Content Script:**
```javascript
// In browser console
console.log('Extension object:', window.UnderstandThisGame);
```

## 📞 **Still Having Issues?**

If the extension still doesn't work:

1. **Check Browser Console** for any error messages
2. **Verify Extension Permissions** in `chrome://extensions/`
3. **Try Different URLs** (localhost vs file://)
4. **Check for Ad Blockers** that might interfere
5. **Restart Browser** completely

The extension should now work with both ESPN.com and the test file!
