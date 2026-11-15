// Use in routes: router.post("/", validate(createCustomerSchema), createCustomer);
// Joi errors are forwarded to your existing global error.middleware.js.
const validate = (schema, source = "body") => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: false,
      convert: true,
    });
    if (error) return next(error);
    // Express 5 request.query is getter-only. Store normalized values in res.locals.
    res.locals.validated = res.locals.validated || {};
    res.locals.validated[source] = value;
    if (source === "body") req.body = value;
    next();
  };
};
export default validate;
