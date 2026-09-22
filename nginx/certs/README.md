Place TLS certificate files here for production nginx:

- `tls.crt`
- `tls.key`

Generate a self-signed pair for local testing:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout tls.key -out tls.crt -subj "/CN=localhost"
```
