from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
print("Idea Lab: http://localhost:8080")
ThreadingHTTPServer(("0.0.0.0", 8080), SimpleHTTPRequestHandler).serve_forever()
