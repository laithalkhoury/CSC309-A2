/* Authentication Middleware Logic, to be called in every route endpoint */

const {expressjwt: jwt} = require('express-jwt');
const prisma = require('../prismaClient');


const authenticate = jwt({
    secret: process.env.JWT_SECRET,
    algorithms: ['HS256']
})

function requires(minRole) {
    const ranking = { regular: 1, cashier: 2, manager: 3, superuser: 4};

    return async (req, res, next) => {
        try {
            if (!req.auth || !req.auth.userId) {
                return res.status(401).json({ error: "Unauthorized"});
            }
            
            const me = await prisma.user.findUnique({where: {id: req.auth.userId }})
            if (!me) {
                return res.status(401).json({error: "Unauthorized"});
            }

            req.me = me; // adds user to request object
            if (ranking[me.role] < ranking[minRole]) {
                return res.status(403).json({error: "Forbidden"}); // can't complete request (not allowed to do so)
            }
            return next();
        }
        catch(err) {
            return next(err);
        }
    };
}

module.exports = { authenticate, requires};