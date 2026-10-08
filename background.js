const SEARCH_URLS = {
  ca: 'https://hiring.amazon.ca/app#/jobSearch',
  com: 'https://hiring.amazon.com/app#/jobSearch',
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'open-search' && SEARCH_URLS[msg.site]) chrome.tabs.create({ url: SEARCH_URLS[msg.site] });
});
