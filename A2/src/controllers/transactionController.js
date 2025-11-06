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
    let pointsEarned = Math.floor(spent / 0.25);

    // Apply promotions if any
    for (const promotion of validPromotions){
        if (promotion.points) {
            pointsEarned += promotion.points;
        }
        if (promotion.rate) {
            pointsEarned += Math.floor(spent * 100 * promotion.rate);
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
            type: "purchase",
            amount: pointsEarned,
            spent: spent,
            suspicious: suspicious,
            remark: remark || "",
            createdById: cashier.id,
            promotions: {
                connect: validPromotions.map(promo => ({ id: promo.id }))
                }
            },
        
        include: {
            promotions: { select: { id: true } }
            }
          });
    
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
        promotionIds: transaction.promotions.map(p => p.id),
        createdBy: cashier.utorid,
    });
}
































// POST /transactions - Create a new adjustment transaction
export const adjustmentTransaction = async(req, res) => {
    const { utorid, type, amount, relatedId, promotionIds = [], remark = "" } = req.body;

    // Validate required fields
    if (!utorid || !type || amount === undefined || relatedId === undefined) {
        throw new Error("Bad Request");
    }

    // Validate utorid format
    const utoridRegex = /^[a-zA-Z0-9]{7,8}$/;
    if (!utoridRegex.test(utorid)) {
        throw new Error("Bad Request");
    }

    // Validate type
    if (type !== "adjustment") {
        throw new Error("Bad Request");
    }

    // Validate amount
    if (typeof amount !== "number") {
        throw new Error("Bad Request");
    }

    // Validate relatedId
    if (typeof relatedId !== "number" || relatedId <=0 ) {
        throw new Error("Bad Request");
    }

    // Find the customer by utorid
    const customer = await prisma.user.findUnique({
        where: { utorid }
    });

    // Check if customer exists
    if (!customer) {
        throw new Error("Bad Request");
    }

    // Find the related transaction
    const relatedTransaction = await prisma.transaction.findUnique({
        where: { id: relatedId }
    });

    // Check if related transaction exists
    if (!relatedTransaction) {
        throw new Error("Bad Request");
    }

    // TODO: Validate promotion IDs if required .......................................................................

    // Get the manager creating the adjustment
    const manager = req.me; // set by auth middleware
    
    // Create the adjustment transaction
    const transaction = await prisma.transaction.create({
        data: {
            userId: customer.id,
            // user
            type: "adjustment",
            amount: amount,
            remark: remark || "",
            relatedId: relatedTransaction.id,
            createdById: manager.id,
            // createdBy
            promotions: {
                connect: promotionIds.map(promo => ({ id: promo.id }))
            }
        },
        include: {
        promotions: { select: { id: true } }
    }
    });

    // Update customer's points DOUBLE CHECK LOGIC IN PIAZZA ...................................
    await prisma.user.update({
        where: {id: customer.id },
        data: { points: customer.points + amount }
    });

    // Return transaction response
    return res.status(201).json({
        id: transaction.id,
        utorid: customer.utorid,
        amount: transaction.amount,
        type: transaction.type,
        relatedId: transaction.relatedId,
        remark: transaction.remark,
        promotionIds: transaction.promotions.map(p => p.id),
        createdBy: manager.utorid,

    })

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
    
    const { transactionId } = req.params;
    const{suspicious} = req.body;

    // Validate transactionId is a number
    const transId = Number(transactionId);
    if (isNaN(transId) || transId <= 0) {
        throw new Error("Bad Request");
    }

    // Validate suspicious fielfd
    if(typeof suspicious !== "boolean") {
        throw new Error("Bad Request");
    }

    // Find the transaction by ID
    let transaction = await prisma.transaction.findUnique({
        where: {id: transId },
        include: { user: true,
            createdBy: true,
            promotions: true
         } 
    })

    // Check if transaction exists
    if (!transaction) {
        throw new Error("Not Found");
    }

    // Check if tranaction suspicious status is already as requested
    if (transaction.suspicious === suspicious){
        return res.status(200).json({
            id: transaction.id,
            utorid: transaction.user.utorid,
            type: transaction.type,
            spent: transaction.spent,
            amount: transaction.amount,
            promotionIds: transaction.promotions.map(p => p.id),
            suspicious: transaction.suspicious,
            remark: transaction.remark,
            createdBy: transaction.createdBy.utorid
        });
    }

    // Update the transaction's suspicious status
    transaction = await prisma.transaction.update({
        where: {id: transId},
        data: {suspicious: suspicious },
        include: { user: true,
            createdBy: true,
            promotions: true
         } 
    })

    // Adjust user's points balance
    let pointAdjustment = 0;

    if (suspicious) {
        // If marking as suspicious, deduct points
        pointAdjustment = -transaction.amount;
    } else{
        // If marking as unsuspicious add points
        pointAdjustment = transaction.amount;
    }

    // Update user's points
    await prisma.user.update({
        where: {id: transaction.userId},
        data: { points: transaction.user.points + pointAdjustment }
    });

    // Return updated transaction details
    return res.status(200).json({
        id: transaction.id,
        utorid: transaction.user.utorid,
        type: transaction.type,
        spent: transaction.spent,
        amount: transaction.amount,
        promotionIds: transaction.promotions.map(p => p.id),
        suspicious: transaction.suspicious,
        remark: transaction.remark,
        createdBy: transaction.createdBy.utorid
    })





}



module.exports = {    postTransaction,
    getTransactions,
    getTransactionById,
    patchTransactionAsSuspiciousById,
    patchRedemptionTransactionStatusById,
    adjustmentTransaction,
};


    