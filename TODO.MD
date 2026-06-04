# TO DO
- Agent note: Always ask clarifying questions before implementing any changes.
- After completing a task, change [ToDo] to [Done].

## Features
- [ToDo] Filter by status
- [ToDo] Add search in progress feedback

## Bugs
- [Done] The search button appears to be in a container that is slightly too small. Clicking and dragging on it displays a scrollbar. It makes clicking on the button difficult because an accidental click-drag is interpreted as a scroll. Ensure that there is no vertical scrolling on the button or any of its containers.

## Tweaks
- [Done] The includes/excludes/blacklist filters currently filter the table as the user types, which causes UI slowdown. Only apply the filter when you have detected the user has finished typing (i.e. a certain number of ms after the last keystroke)
- [Done] When the user clicks the search button, swap the search icon out for a rotating progress icon while the search is underway.
