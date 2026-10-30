# Approved local-network transfer

Network transfer is functional and tested over actual TLS, including through two Electron instances on one Mac. It remains **experimental until physical two-Mac validation**. File-based import/export remains available.

## Receiver

Choose a new destination and protected pairing-descriptor path. For LAN use, explicitly bind a reachable local address and advertise it:

```sh
devteleport receive --target /path/to/received.dtp \
  --pairing-output /private/path/pairing.json \
  --bind 0.0.0.0 --advertise 192.168.1.20 --approve-receive
```

Default bind is loopback `127.0.0.1`, suitable for same-Mac testing only. The receiver reports address, expiry and certificate fingerprint, not the secret token. Share the 0600 pairing descriptor out of band through a trusted channel, and compare the displayed fingerprint. Do not publish it. Pairing approval grants one file-transfer session; it never grants command execution or snapshot decryption.

## Sender

```sh
devteleport pairing-info --pairing /private/path/pairing.json
# Compare with the receiver before approving.
devteleport send project.dtp --pairing /private/path/pairing.json --approve-peer
```

The sender prompts for the snapshot passphrase to authenticate its archive before upload. The receiver does not learn that passphrase. It verifies encrypted-file length/SHA-256 and format marker, then publishes without overwrite. Receiving is not decryption: restore later authenticates all archive contents and checksums.

## Protocol and recovery

Transport uses standard HTTPS/TLS 1.3 with an ephemeral self-signed RSA-3072 certificate and explicit CA trust from the approved descriptor. Certificate/hostname verification stays enabled. A random 256-bit bearer token authenticates every status/upload request and is compared with timing-safe equality. No custom cipher or unauthenticated public upload endpoint is used. Manual addresses are supported; Bonjour discovery is not implemented. No firewall protection is disabled; allow the normal application network permission only if you intend to receive on the LAN.

Transfers are streamed with bounds/timeouts, exclusive partial creation, no-clobber publication and durable state. Retry sending within the session to resume at the receiver's partial-file size. After a receiver restart, use `--resume`, the same selected target, a **new pairing output file**, and compare the new fingerprint before approving. Mismatched source hash/size is refused. A checksum failure preserves evidence and may require a new destination instead of automatic repair. The receiver never executes archive contents. Pairing files expire; remove/share them according to your local credential policy.

Limitations: no identity directory, mDNS discovery, relay/NAT traversal, automatic firewall reconfiguration, multi-sender server or physical-device certification. Pairing depends on trusted out-of-band descriptor/fingerprint exchange; possession of the secret descriptor authorizes that session. Local owner/admin and destination-parent integrity remain trusted assumptions. Peer-to-peer progress and same-host tests are not physical Mac-to-Mac evidence.
