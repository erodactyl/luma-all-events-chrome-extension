// Toolbar button: open the overlay on a Luma tab, otherwise open Luma with it.
chrome.action.onClicked.addListener(async (tab) => {
  const onLuma = tab.url && /^https:\/\/(luma\.com|lu\.ma)\//.test(tab.url);
  if (onLuma) {
    try {
      await chrome.tabs.sendMessage(tab.id, 'open-all-events');
      return;
    } catch {
      // Tab was open before the extension was installed, so it has no content script yet.
      await chrome.tabs.update(tab.id, { url: 'https://luma.com/discover#all-events' });
      return;
    }
  }
  chrome.tabs.create({ url: 'https://luma.com/discover#all-events' });
});
