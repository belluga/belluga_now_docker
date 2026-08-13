#!/usr/bin/env python3
import os
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path


USAGE = """Usage:
  manage_local_navigation_loopback_bridge.py start <pid-file> <log-file>
  manage_local_navigation_loopback_bridge.py stop <pid-file> [log-file]

This helper manages a local loopback bridge for the canonical local-public
browser contract:
  127.0.0.1:80  -> 127.0.0.1:8081
  127.0.0.1:443 -> 127.0.0.1:8043
"""

HTTP_BIND = ("127.0.0.1", 80)
HTTP_TARGET = ("127.0.0.1", 8081)
HTTPS_BIND = ("127.0.0.1", 443)
HTTPS_TARGET = ("127.0.0.1", 8043)


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def read_pid(pid_file: Path) -> int | None:
    if not pid_file.exists():
        return None
    raw = pid_file.read_text(encoding="utf-8").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def write_pid(pid_file: Path, pid: int) -> None:
    pid_file.parent.mkdir(parents=True, exist_ok=True)
    pid_file.write_text(f"{pid}\n", encoding="utf-8")


def cleanup_pid_file(pid_file: Path, pid: int) -> None:
    current = read_pid(pid_file)
    if current == pid:
        pid_file.unlink(missing_ok=True)


class ProxyHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        upstream = socket.create_connection(
            (self.server.target_host, self.server.target_port)
        )
        threads = [
            threading.Thread(
                target=self._forward, args=(self.request, upstream), daemon=True
            ),
            threading.Thread(
                target=self._forward, args=(upstream, self.request), daemon=True
            ),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

    @staticmethod
    def _forward(source: socket.socket, destination: socket.socket) -> None:
        try:
            while True:
                chunk = source.recv(65536)
                if not chunk:
                    break
                destination.sendall(chunk)
        except OSError:
            pass
        finally:
            try:
                destination.shutdown(socket.SHUT_WR)
            except OSError:
                pass


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def build_server(bind_host: str, bind_port: int, target_host: str, target_port: int):
    server = ThreadedTCPServer((bind_host, bind_port), ProxyHandler)
    server.target_host = target_host
    server.target_port = target_port
    return server


def serve(pid_file: Path) -> int:
    servers = [
        build_server(*HTTP_BIND, *HTTP_TARGET),
        build_server(*HTTPS_BIND, *HTTPS_TARGET),
    ]
    threads = []
    stop_event = threading.Event()

    def shutdown(*_args) -> None:
        if stop_event.is_set():
            return
        stop_event.set()
        for server in servers:
            server.shutdown()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    write_pid(pid_file, os.getpid())

    try:
        for server in servers:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            threads.append(thread)
        while not stop_event.is_set():
            time.sleep(1)
    finally:
        for server in servers:
            try:
                server.server_close()
            except OSError:
                pass
        cleanup_pid_file(pid_file, os.getpid())

    return 0


def start(pid_file: Path, log_file: Path) -> int:
    existing_pid = read_pid(pid_file)
    if existing_pid is not None and process_alive(existing_pid):
        print(f"INFO: local loopback bridge already running with pid {existing_pid}.")
        return 0
    if existing_pid is not None:
        pid_file.unlink(missing_ok=True)

    pid_file.parent.mkdir(parents=True, exist_ok=True)
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("ab") as log_handle:
        process = subprocess.Popen(
            [sys.executable, __file__, "serve", str(pid_file)],
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )

    deadline = time.time() + 3
    while time.time() < deadline:
        if process.poll() is not None:
            print(
                f"ERROR: local loopback bridge failed to start (rc={process.returncode}).",
                file=sys.stderr,
            )
            return 1
        current_pid = read_pid(pid_file)
        if current_pid == process.pid:
            print(f"INFO: local loopback bridge started with pid {process.pid}.")
            return 0
        time.sleep(0.1)

    print("ERROR: local loopback bridge did not publish a pid file in time.", file=sys.stderr)
    return 1


def stop(pid_file: Path) -> int:
    pid = read_pid(pid_file)
    if pid is None:
        print("INFO: local loopback bridge is not running.")
        return 0

    if not process_alive(pid):
        pid_file.unlink(missing_ok=True)
        print("INFO: local loopback bridge pid file was stale and has been cleared.")
        return 0

    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pid_file.unlink(missing_ok=True)
        print("INFO: local loopback bridge already stopped.")
        return 0

    deadline = time.time() + 5
    while time.time() < deadline:
        if not process_alive(pid):
            pid_file.unlink(missing_ok=True)
            print(f"INFO: local loopback bridge stopped (pid {pid}).")
            return 0
        time.sleep(0.1)

    os.killpg(pid, signal.SIGKILL)
    pid_file.unlink(missing_ok=True)
    print(f"INFO: local loopback bridge force-stopped (pid {pid}).")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(USAGE, file=sys.stderr)
        return 2

    command = argv[1]
    pid_file = Path(argv[2]).resolve()

    if command == "serve":
        return serve(pid_file)
    if command == "start":
        if len(argv) != 4:
            print(USAGE, file=sys.stderr)
            return 2
        log_file = Path(argv[3]).resolve()
        return start(pid_file, log_file)
    if command == "stop":
        return stop(pid_file)

    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
