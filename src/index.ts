#!/usr/bin/env node
import express, { Request as ExpressRequest, Response as ExpressResponse } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import minimist from "minimist";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { registerMarkmapTools } from "./mcp/tools/markmap-tools.js";
import logger from "./utils/logger.js";

/**
 * Parses and validates command line arguments for the Markmap MCP Server.
 *
 * @returns Configuration object with input and output file options
 */
function parseArgs() {
    const args = minimist(process.argv.slice(2), {
        string: ["output"],
        boolean: ["help"],
        alias: {
            o: "output",
            h: "help"
        }
    });

    if (args.help) {
        logger.info(`Markmap MCP Server - Mind map generator for Markdown

  Usage: markmap-mcp-server [options]

  Options:
    --output, -o <file>        Output HTML file directory
    --help, -h                 Show this help message`);
        process.exit(0);
    }

    return {
        output: args.output || process.env.MARKMAP_DIR,
        open: args.open || false
    };
}

/**
 * Main function that initializes and starts the Markmap MCP Server.
 * This function sets up HTTP transport on port 3000 with JSON response mode.
 */
async function main() {
    const options = parseArgs();

    // Set up Express app
    const app = express();
    app.use(express.json());
    app.use(cors({
        origin: "*", // Allow all origins
        exposedHeaders: ["Mcp-Session-Id"]
    }));

    // Map to store transports by session ID
    const transports: { [key: string]: any } = {};

    let outputPath;
    if (options.output) {
        if (!existsSync(options.output)) {
            mkdirSync(options.output, { recursive: true });
        }
        outputPath = options.output;
    } else {
        const tempDir = join(tmpdir(), "markmap");
        if (!existsSync(tempDir)) {
            mkdirSync(tempDir, { recursive: true });
        }
        outputPath = tempDir;
    }

    app.post("/mcp", async (req: ExpressRequest, res: ExpressResponse) => {
        const method = req.method;
        const url = req.url;
        const userAgent = req.headers['user-agent'] || '-';
        const timestamp = new Date().toISOString();
        const sessionId = req.headers["mcp-session-id"] as string || null;

        console.log(JSON.stringify({
            timestamp,
            level: "info",
            method,
            url,
            sessionId,
            userAgent,
            message: "HTTP request received"
        }));

        // Set appropriate headers for MCP responses
        res.setHeader("Content-Type", "application/json");

        try {
            // Check for existing session ID
            const sessionId = req.headers["mcp-session-id"] as string;
            let transport: any;

            if (sessionId && transports[sessionId]) {
                // Reuse existing transport
                transport = transports[sessionId];
            }
            else if (!sessionId && isInitializeRequest(req.body)) {
                // New initialization request - use JSON response mode
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    enableJsonResponse: true, // Enable JSON response mode for structured responses
                    onsessioninitialized: (session_Id: string) => {
                        // Store the transport by session ID when session is initialized
                        const timestamp = new Date().toISOString();
                        console.log(JSON.stringify({
                            timestamp,
                            level: "info",
                            event: "session_initialized",
                            sessionId: session_Id,
                            message: "New session initialized"
                        }));
                        transports[session_Id] = transport;
                    }
                });

                // Connect the transport to the MCP server BEFORE handling the request
                const server = new McpServer({
                    name: "Markmap MCP Server",
                    version: "0.1.0"
                });

                registerMarkmapTools(server, { output: outputPath });
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
                return; // Already handled
            }
            else {
                // Invalid request - no session ID or not initialization request
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32000,
                        message: "Bad Request: No valid session ID provided"
                    },
                    id: null
                });
                return;
            }

            // Handle the request with existing transport - no need to reconnect
            await transport.handleRequest(req, res, req.body);
        }
        catch (error) {
            const timestamp = new Date().toISOString();
            const method = req.method;
            const url = req.url;
            const userAgent = req.headers['user-agent'] || '-';
            const sessionId = req.headers["mcp-session-id"] as string || null;

            console.error(JSON.stringify({
                timestamp,
                level: "error",
                method,
                url,
                sessionId,
                userAgent,
                message: "Error handling MCP request",
                error: error instanceof Error ? error.message : String(error)
            }));
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message: "Internal server error"
                    },
                    id: null
                });
            }
        }
    });

    // Handle GET requests for SSE streams according to spec
    app.get("/mcp", async (req: ExpressRequest, res: ExpressResponse) => {
        const method = req.method;
        const url = req.url;
        const userAgent = req.headers['user-agent'] || '-';
        const timestamp = new Date().toISOString();
        const sessionId = req.headers["mcp-session-id"] as string;

        // Check for session ID
        if (!sessionId || !transports[sessionId]) {
            console.log(JSON.stringify({
                timestamp,
                level: "warn",
                method,
                url,
                sessionId,
                userAgent,
                message: "Invalid or missing session ID"
            }));
            res.status(400).send("Invalid or missing session ID");
            return;
        }

        // Check for Last-Event-ID header for resumability
        const lastEventId = req.headers["last-event-id"];
        if (lastEventId) {
            console.log(JSON.stringify({
                timestamp,
                level: "info",
                method,
                url,
                sessionId,
                lastEventId,
                userAgent,
                message: "Reconnecting SSE stream with Last-Event-ID"
            }));
        } else {
            console.log(JSON.stringify({
                timestamp,
                level: "info",
                method,
                url,
                sessionId,
                userAgent,
                message: "Establishing new SSE stream"
            }));
        }

        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
    });

    // Handle DELETE requests for session termination (according to MCP spec)
    app.delete("/mcp", async (req: ExpressRequest, res: ExpressResponse) => {
        const method = req.method;
        const url = req.url;
        const userAgent = req.headers['user-agent'] || '-';
        const timestamp = new Date().toISOString();
        const sessionId = req.headers["mcp-session-id"] as string;

        if (!sessionId || !transports[sessionId]) {
            console.log(JSON.stringify({
                timestamp,
                level: "warn",
                method,
                url,
                sessionId,
                userAgent,
                message: "Invalid or missing session ID"
            }));
            res.status(400).send("Invalid or missing session ID");
            return;
        }

        console.log(JSON.stringify({
            timestamp,
            level: "info",
            method,
            url,
            sessionId,
            userAgent,
            message: "Terminating session"
        }));

        try {
            const transport = transports[sessionId];
            await transport.handleRequest(req, res);
            // Clean up the transport
            if (sessionId && transports[sessionId]) {
                console.log(JSON.stringify({
                    timestamp,
                    level: "info",
                    event: "session_terminated",
                    sessionId,
                    message: "Transport closed and removed from map"
                }));
                delete transports[sessionId];
            }
        } catch (error) {
            console.error(JSON.stringify({
                timestamp,
                level: "error",
                method,
                url,
                sessionId,
                userAgent,
                message: "Error handling session termination",
                error: error instanceof Error ? error.message : String(error)
            }));
            if (!res.headersSent) {
                res.status(500).send("Error processing session termination");
            }
        }
    });

    // Start the server on port 3000
    const PORT = 3000;
    const server = app.listen(PORT, () => {
        const timestamp = new Date().toISOString();
        logger.info(JSON.stringify({
            timestamp,
            level: "info",
            event: "server_started",
            port: PORT,
            protocol: "HTTP",
            message: "Markmap MCP Server started successfully"
        }));
    });

    // Handle server shutdown
    process.on("SIGINT", async () => {
        const timestamp = new Date().toISOString();
        logger.info(JSON.stringify({
            timestamp,
            level: "info",
            event: "shutdown_initiated",
            signal: "SIGINT",
            message: "Shutting down Markmap MCP Server..."
        }));
        // Close all active transports to properly clean up resources
        for (const sessionId in transports) {
            try {
                logger.info(JSON.stringify({
                    timestamp,
                    level: "info",
                    event: "transport_closing",
                    sessionId,
                    message: "Closing transport for session"
                }));
                await transports[sessionId].close();
                delete transports[sessionId];
            } catch (error) {
                logger.error(JSON.stringify({
                    timestamp,
                    level: "error",
                    event: "transport_close_error",
                    sessionId,
                    message: "Error closing transport",
                    error: error instanceof Error ? error.message : String(error)
                }));
            }
        }
        logger.info(JSON.stringify({
            timestamp,
            level: "info",
            event: "server_shutdown_complete",
            message: "Markmap MCP Server shutdown complete"
        }));
        process.exit(0);
    });
}

main().catch((error) => {
    logger.error("Failed to start Markmap MCP Server: %s", error);
    process.exit(1);
});
