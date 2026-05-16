# Search Refactor
Refactor the search to be quicker and more reliable. Currently, every search runs completely from scratch, which is inefficient (since it mostly returns the same results) and unreliable (since some job boards are unreliable and results change each time). We should refactor the search to run as follows:
1. When the user clicks refresh, or loads the dashboard AND it has been over 4 hours since the last refresh, run a JobSpy search (using CONFIG.MD properties as normal), limited to only the time period since the last refresh. If the cache is empty, let the time period be 7 days.
NOTE: This won't work because if a search is flaky then the next refresh will not re-do it
2. 
