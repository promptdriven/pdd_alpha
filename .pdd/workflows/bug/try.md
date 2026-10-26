# Use a project preview if useful

If the project has a safe local preview or demo that helps explain the fix, offer
its documented command and report actual observations for this revision. This
optional preview does not replace the required contract check. A link or mockup
alone is not a completed interaction; name missing coverage and continue with
relevant tests. In the stage report, optionally add returned links:
`links:[{stage:'<current stage id>',kind:'check|try|replay',url:'https://...',verdict:'passed|failed|unknown|null'}]`.
Try links use `verdict:null`; include only HTTPS links from pdd check/try/replay output.
