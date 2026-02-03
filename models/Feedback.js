const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Feedback = sequelize.define('Feedback', {
        feedback_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        target_user_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        rental_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        rate: {
            type: DataTypes.INTEGER,
            allowNull: false,
            validate: {
                min: 1,
                max: 5,
            },
        },
        review: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'feedbacks',
        timestamps: false,
    });

    Feedback.associate = (models) => {
        Feedback.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'author',
        });
        Feedback.belongsTo(models.User, {
            foreignKey: 'target_user_id',
            as: 'targetUser',
        });
        Feedback.belongsTo(models.Rental, {
            foreignKey: 'rental_id',
            as: 'rental',
        });
    };

    return Feedback;
};
