import fs from "fs";
import path from "path";
import express from "express";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "HEAD",
];

const routesMetadata = [];

async function createRouter(dir, options = {}, baseRoute = "") {
  const router = options.router || new options.express.Router();

  const absoluteDir = path.resolve(dir);
  const files = fs.readdirSync(absoluteDir);

  for (const file of files) {
    const filePath = path.join(absoluteDir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      const nestedRouter = await createRouter(
        filePath,
        {
          ...options,
          router: options.express.Router(),
        },
        `${baseRoute}/${file}`
      );

      router.use(`/${file}`, nestedRouter);
    } else if (stat.isFile() && path.extname(file) === ".js") {
      let expressRoute = `/${path.basename(file, ".js")}`;

      let fullRoute = `${baseRoute}/${path.basename(file, ".js")}`;
      let isApiRoute = false;

      if (filePath.includes("api")) {
        isApiRoute = true;
      }

      if (file.startsWith("[") && file.endsWith("].js")) {
        const paramName = file.slice(1, -4);
        expressRoute = `/:${paramName}`;
        fullRoute = `${baseRoute}/:${paramName}`;
      }

      try {
        const module = await import(`file://${filePath}`);

        const middleware = module.middleware || [];

        if (!Array.isArray(middleware)) {
          throw new Error(`Middleware for ${filePath} must be an array`);
        }

        if (isApiRoute) {
          HTTP_METHODS.forEach((method) => {
            if (typeof module[method] === "function") {
              if (typeof module.metadata !== "undefined") {
                routesMetadata.push({
                  method: method.toUpperCase(),
                  path: fullRoute,
                  filePath: filePath,
                  metadata: module.metadata,
                });
              }

              router[method.toLowerCase()](
                expressRoute,
                ...middleware,
                module[method]
              );
            }
          });
        } else {
          const handler = module.default;
          if (typeof handler !== "function") {
            throw new Error(
              `Page route ${filePath} does not export a function`
            );
          }

          router.all(expressRoute, ...middleware, handler);
        }
      } catch (error) {
        console.log(`Error for ${filePath}:, error.message`);
      }
    }
  }

  return router;
}

export async function fileRouter(dir, express, swaggerOptions, serverConfig) {
  const router = await createRouter(dir, { express });
  const swaggerSpec = swaggerJSDoc(swaggerOptions);

  swaggerSpec.paths = {};

  routesMetadata.forEach((route) => {
    if (!swaggerSpec.paths[route.path]) {
      swaggerSpec.paths[route.path] = {};
    }

    swaggerSpec.paths[route.path][route.method.toLowerCase()] = {
      summary: route.metadata?.summary,
      description: route.metadata?.description,
      responses: route.metadata?.responses,
    };
  });

  const app = express();

  app.use("/", router);
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.listen(serverConfig.port, () => {
    console.log("Server started on http://localhost:3000");
  });
}

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "API Documentation",
      version: "1.0.0",
      description: "Automatically generated API documentation",
    },
    servers: [
      {
        url: "http://localhost:3000",
      },
    ],
  },
  apis: ["./pages/**/*.js"],
};

const serverConfig = {
  port: 3000,
};

fileRouter("./pages", express, swaggerOptions, serverConfig);
