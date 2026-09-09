# Guardian Terms of Service

**Draft. Not published, and not reviewed by counsel.** Written to be checked
rather than trusted: everything it promises is something the code does, and
everything it forbids is something the code refuses. A lawyer should rewrite the
language. The obligations are the part worth arguing about.

Last checked against the code: 2026-09-09.

## Who this is between

Guardian, and the operator who installs it. An operator is whoever runs the
service the chat is on: a Discord server owner, or a platform using the API.

Members of that service are not party to this. They are the people being read,
which is why the operator carries the obligations in "What you agree to" below.

## What Guardian does

Reads chat the operator already has the right to read. Scores it for the pattern
of an adult grooming a child. Puts anything that looks like the pattern in front
of a person, and gives that person the evidence to decide.

## What Guardian does not do

- It does not decide anything about a person. The highest level a model reaches
  is "needs review". Confirming a report takes two human reviewers, and the
  second cannot be the first.
- It does not label anyone. It describes conversations.
- It does not contact police, publish anything, or maintain a list. There is one
  reporting path, the NCMEC CyberTipline, and a person starts it.
- It does not read direct messages, ever.
- It does not hold images or video. Only a fingerprint and the operator's own
  scanner verdict.
- It does not create accounts, profiles or messages. It never poses as a child
  to draw anyone out.

## What you agree to

**You have the authority to read this traffic.** You run the service, or the
device owner authorized it. Guardian will not help you read anything you do not
already have the right to read, and installing it somewhere you lack that right
is a breach of these terms and probably of the law.

**You tell your members.** Anyone whose messages Guardian reads is entitled to
know. For a Discord server that means the server's own rules or description
saying so. Covert use is forbidden, and it is the one term here that cannot be
waived by agreement.

**You do not redistribute an alert.** Guardian's alerts describe a conversation
and name two accounts. Screenshotting one into a public channel, another server,
or a "predator catching" community turns a private safety signal into a
publication about a person. It is forbidden, and it is the failure mode this
product was designed against: the alert wording is deliberately unusable as an
accusation, and that only holds if the alert stays where it was sent.

**You do not act on an alert as though it were a finding.** A risk level says a
conversation is worth a person's attention. It does not say anyone did anything.

**You are the reporter.** If a report goes to NCMEC, it goes under your name as
the provider. Guardian prepares the evidence. It does not file on your behalf
unless you have registered with NCMEC and configured it to.

**You keep your reviewers' access to what they need.** Reviewers read children's
words. Give the seat to people who should have it.

## What Guardian owes you

- The retention schedule in the [privacy policy](PRIVACY.md), enforced by a
  scheduled job rather than by intention.
- An append-only record of every score and every decision, which you can verify
  and export yourself without Guardian's help or its key.
- Honest numbers. Guardian's published detection rates come from generated
  traffic until enough real conversations exist to replace them, and the model
  card says so rather than burying it.

## What it does not cover

Guardian reads text. It does not see voice, video, images, or anything said on a
service it is not installed on. A conversation that moves to another app is one
Guardian can see the move to and nothing after. It is one signal among the ones
you already have, not a guarantee that a child is safe.

## Ending it

You can remove Guardian at any time. Data under an active preservation duty
stays for the year that duty runs, because that obligation is owed to a federal
process rather than to Guardian. Everything else is deleted on its own schedule.
