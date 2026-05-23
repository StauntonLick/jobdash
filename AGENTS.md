# This file contains rules, guidelines and best practices for Copilot to follow when generating code for JobDash.

## General Guidelines

- This is a personal project and will be shared for free on Github, so all code should be open-source friendly and free of any proprietary or licensed content.
- Ask clarifying questions before following a command if there is key information missing from the prompt or context.
- Unless told explicitly, always confirm an action with the user before carrying it out.
- After carrying out an action, add a record of it to HISTORY.MD. If the change is rolled back, remove that record.
- Always ask questions prior to carrying out an action if you are unsure of the request. Do not guess.

## Design

- I am a designer and am particular about the UI and UX. 
- I want a good level of control over the UI, and the ability to polish (either via the agent or by hand)
- When I ask you to implement a design from Figma, run a check post-implementation against the design file to ensure the build matches the design.
- When implementing small design tweaks do not ask permission before continuing - just implement as per the Figma design.

## Code

- I am not a developer, so I want the code to be as simple and readable as possible, with comments where necessary to explain what is going on.
- Give all high-level HTML elements a human-readable semantic ID to aid with code readability.
- Do not update the build (on port 3001) without permission. Only update the dev server (on 3000).
- To update the live build: 
    cd "/Users/jonny/Coding Projects/JobDash/dashboard"
    npm run build
    npx pm2 restart jobdash
