const { v4: uuidv4 } = require("uuid");
const prisma = require("../prismaClient");
const { generateToken } = require("../services/jwt");
const { hashPassword, comparePassword } = require("../services/bcrypt");


// POST /transactions - Create a new transaction
export const postTransaction = async(req, res) => {
    
    const { utorid, type, spent, promotionIDs = [], remark = "" } = req.body;

    // Validate required fields
    if (!utorid || !type || spent === undefined) {
        throw new Error("Bad Request");
    }

    // Validate utorid format
    const utoridRegex = /^[a-zA-Z0-9]{7,8}$/;
    if (!utoridRegex.test(utorid)) {
        throw new Error("Bad Request");
    }

    //Validate type
    if (type !== "purchase") {
        throw new Error("Bad Request");
    }

    // Validate spent amount
    if (typeof spent !== "number" || spent < 0) {
        throw new Error("Bad Request");
    }

    // Find the customer by utorid
    const customer = await prisma.user.findUnique({
        where: { utorid }
    });

    if (!customer) {
        throw new Error("Bad Request");
    }

    // Validate promotion IDs if provided
    let validPromotions = [];
    if (promotionIDs.length > 0){
        validPromotions = await prisma.Promotion.findMany({
            where: {
                id: { in: promotionIDs },
                startTime: {lte: new Date() },
                endTime: {gte: new Date() }
            },
            include: {
                usedByUsers: true
            }
        });

        // Check if all provided promotion IDs are valid
        if (validPromotions.length !== promotionIDs.length) {
            throw new Error("Bad Request");
            }
        
        // Check if customer has already used any of the promotions
        for (const promotion of validPromotions) {
            if (promotion.type === "onetime") {
                const alreadyUsed = promotion.usedByUsers.some(user => user.id === customer.id);
                if (alreadyUsed) {
                    throw new Error("Bad Request");
                }
                }
            }
        
        // Check minimum spending requirements
        for (const promotion of validPromotions){
            if (promotion.minSpending && spent < promotion.minSpending) {
                throw new Error("Bad Request");
            }
        }
    }

    // Calculate points 
    let pointsEarned = Math.ceil(spent * 4);

    // Apply promotions if any
    for (const promotion of validPromotions){
        if (promotion.points) {
            pointsEarned += promotion.points;
        }
        if (promotion.rate) {
            pointsEarned += Math.ceil(spent * 100 * promotion.rate);
        }
    }

    // Check if cashier is suspicious (requires manager verification)
    const cashier = req.me; // set by auth middleware
    let suspicious = false;
    if (cashier.suspicious) {
        suspicious = true;
    }

    // Create the transaction
    const transaction = await prisma.transaction.create({
        data: {
            userId: customer.id,
            // TODO user ... how do i Fill ...................................................................
            type: "purchase",
            amount: pointsEarned,
            spent: spent,
            suspicious: suspicious,
            remark: remark || "",
            // what is related id ...................................................................
            createdById: cashier.id,
            // TODO createdBY ... how do i Fill ...................................................................
            // add promotions used
            /////// finish later

        }    });
    
    // FINISH ABOVE INSERT

    // Update customer's points if cashier is not suspicious
    if (!suspicious){
        await prisma.user.update({
            where: { id: customer.id },
            data: {
                points: customer.points + pointsEarned
            }
        });
    }

    // Add promotions used by a user

    await prisma.user.update({
        where: { id: customer.id },
        data: {
            usedPromotions: {
                connect: validPromotions.map(promo => ({ id: promo.id }))
            }
        }
    });
    
    
    // If suspicious, points are stored in transaction but not added to user's balance
    // Manager will later verify and award points through a separate endpoint....................................

    // Return transaction response
    return res.status(201).json({
        id: transaction.id,
        utorid: customer.utorid,
        type: transaction.type,
        spent: transaction.spent,
        earned: suspicious ? 0 : transaction.amount, // if suspicious, earned points are 0.........................
        remark: transaction.remark,
        promotionIDs: transaction.promotions.map(p => p.id),
        createdBy: cashier.utorid,
    });
}

// POST /transactions - Create a new adjustment transaction
export const adjustmentTransaction = async(req, res) => {
    // To be implemented
}


// GET /transactions - Retrieve a list of transactions
export const getTransactions = async(req, res) => {
    // To be implemented
}

// GET /transactions/:transactionId - Retrieve a single transaction by ID
export const getTransactionById = async(req, res) => {
    const { transactionId } = req.params;

    // Validate transactionId is a number
    const id = Number(transactionId);
    if (isNaN(id) || id <= 0) {
        throw new Error("Bad Request");
    }

    // Find the transaction by ID
    const transaction = await prisma.transaction.findUnique({
        where: { id: id },
        include: {
            user: true,
            createdBy: true,
            promotions: true
        }
    });

    // Check if transaction exists
    if(!transaction) {
        throw new Error("Not Found");
    }

    // Return transaction details
    return res.status(200).json({
        id: transaction.id,
        utorid: transaction.user.utorid,
        type: transaction.type,
        spent: transaction.spent,
        amount: transaction.amount,
        promotionIDs: transaction.promotions.map(p => p.id),
        suspicious: transaction.suspicious,
        remark: transaction.remark,
        createdBy: transaction.createdBy.utorid

    });
}

// PATCH /transactions/:transactionId/suspicious - Mark a transaction as suspicious (manager only)
export const patchTransactionAsSuspiciousById = async(req, res) => {
    // To be implemented
}



    