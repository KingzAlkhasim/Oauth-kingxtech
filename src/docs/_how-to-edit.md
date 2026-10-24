# How to edit these docs (not shown on the site)

Every page in this folder is a plain Markdown file. Files whose names start with an underscore, like this one, are never shown.

## Change a page
Open the file on GitHub, tap the pencil icon, edit the text and commit. After the site redeploys the change is live.

## Add a page
Create a new file named like `11-my-topic.md`. The number sets the order and the rest becomes the web address (`/docs/my-topic`). The first line must be `# Page title`. A line starting with `> ` right after it is the short summary shown on the docs home and in search.

## Add a YouTube video
Every page has a line like this:

    {{video: PASTE_YOUTUBE_LINK_HERE}}

Replace `PASTE_YOUTUBE_LINK_HERE` with your video link, for example `https://youtu.be/abc123XYZ00`. Until you do, that line is hidden. Delete the line if a page does not need a video.

## Links
Link to another docs page with `[text](/docs/page-name)`, to an app page with `[text](/usage)`, and to anything else with a full `https://` link.

## Keep it current
When a feature changes, update its page in the same change. Tables are not supported; use bullet lists.
