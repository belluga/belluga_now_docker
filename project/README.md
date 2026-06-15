# Project Overlay Surfaces

This directory is downstream-owned. It exists so Boilerplate/base templates can stay generic while the concrete project keeps its own route inventory and reference contracts.

Current contents:

- `nginx/routes.conf`: active Belluga Now-specific NGINX route overlay consumed by the shared root templates.
- `nginx/routes.conf.example`: reusable example mechanism for future downstreams. Current Belluga route families appear only as comments/reference.
- `well-known/*.example.json`: reference payload shapes for App Links / Universal Links contracts. Runtime delivery remains backend-owned; these files are not the production source of truth.
